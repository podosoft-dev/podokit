const VALID_MODES = new Set(["full", "smoke", "package-smoke"]);

export function resolveE2eOptions(args, environment = process.env) {
  const smoke = args.includes("--smoke");
  const packageSmoke = args.includes("--package-smoke");
  const keep = args.includes("--keep") || environment.KEEP === "1";
  const grepIndex = args.indexOf("--grep");
  const grep = grepIndex === -1 ? environment.GREP : args[grepIndex + 1];

  if (grepIndex !== -1 && !grep) {
    throw new Error("--grep requires a pattern");
  }
  if (packageSmoke && (smoke || grep)) {
    throw new Error("--package-smoke cannot be combined with --smoke or --grep");
  }

  const mode = packageSmoke ? "package-smoke" : smoke ? "smoke" : "full";
  if (!VALID_MODES.has(mode)) {
    throw new Error(`unsupported e2e mode: ${mode}`);
  }

  return { mode, grep, keep };
}

// Bun runs the generated suite's runner, tests/run-e2e.ts, with these
// arguments. With more than one worker it runs the tests tagged @exclusive in a
// second Playwright run, which a failure in the first one does not skip.
export function suiteArguments({ mode, grep }) {
  if (mode === "package-smoke") {
    throw new Error("package-smoke does not run Playwright");
  }
  return ["run-e2e.ts", ...(grep ? ["--grep", grep] : mode === "smoke" ? ["--grep", "@smoke"] : [])];
}

// The full suite runs on two workers; a filtered run is small and keeps one.
export function playwrightWorkers({ mode, grep }, environment = process.env) {
  if (environment.E2E_WORKERS) return environment.E2E_WORKERS;
  return mode === "full" && !grep ? "2" : "1";
}

function formatDuration(milliseconds) {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

export function createPhaseTimer({ now = () => performance.now(), log = console.log } = {}) {
  const phases = [];
  const startedAt = now();
  let active = null;
  let completed = false;

  function completeActive() {
    if (!active) return;
    const elapsedMs = now() - active.startedAt;
    phases.push({ name: active.name, elapsedMs });
    log(`   completed in ${formatDuration(elapsedMs)}`);
    active = null;
  }

  return {
    start(name) {
      if (completed) throw new Error("cannot start a phase after the timer is complete");
      completeActive();
      active = { name, startedAt: now() };
      log(`\n── ${name}`);
    },
    finish() {
      if (completed) return phases;
      completeActive();
      completed = true;
      log("\n── phase timings");
      for (const phase of phases) {
        log(`   ${formatDuration(phase.elapsedMs).padStart(7)}  ${phase.name}`);
      }
      log(`   ${formatDuration(now() - startedAt).padStart(7)}  total`);
      return phases;
    },
  };
}

// Better Auth reports a schema mismatch when an instance starts before the schema
// matches. A migration run that loads it too early prints that report even when it
// succeeds, so a clean run must not contain it.
export function assertCleanMigrationOutput(output) {
  if (output.includes("Database schema mismatch")) {
    throw new Error("migrate:all reported a Better Auth schema mismatch before migrating");
  }
}

// The local registry the Outer loop publishes to. Verdaccio 7 verifies bearer
// tokens on the package API and rejects the dummy token the publish step uses
// (E401), so the version stays exact rather than following npm's latest.
export const VERDACCIO_PACKAGE = "verdaccio@6.11.1";

// Waits before each retry of an install that failed on a registry or network
// error. The first wait outlasts the uplink fail_timeout in verdaccio.yaml, so
// Verdaccio asks npm again instead of answering from its offline state.
export const INSTALL_RETRY_DELAYS_MS = [10_000, 30_000];

const BUN_GET_FAILURE = /^error: GET (\S+) - (\d{3})\b/;
const BUN_DOWNLOAD_FAILURE = /^error: (\w+) downloading (?:package manifest|tarball) (\S+)/;
const BUN_NO_MATCHING_VERSION = /^error: No version matching /;

function packageNameFromUrl(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.slice(1));
  } catch {
    return url;
  }
}

/**
 * The reason a failed `bun install` or `bun add` is worth retrying, or null.
 * A 404 for a package outside the local scopes means the local registry could
 * not reach npm, because Verdaccio answers 404 when its uplink fails; registry
 * 5xx/408/429 answers and connection or DNS failures are transient too. A
 * missing local package or version is a real resolution error, and any real
 * error in the output rules out a retry. A public package that truly does not
 * exist is retried and still fails after the bounded attempts.
 */
export function transientInstallFailure(output, localScopes = ["@podosoft/"]) {
  let transient = null;
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    if (BUN_NO_MATCHING_VERSION.test(line)) return null;
    const get = BUN_GET_FAILURE.exec(line);
    if (get) {
      const status = Number(get[2]);
      if (status === 404) {
        const name = packageNameFromUrl(get[1]);
        if (localScopes.some((scope) => name.startsWith(scope))) return null;
      } else if (status !== 408 && status !== 429 && status < 500) {
        return null;
      }
      transient ??= line;
      continue;
    }
    if (BUN_DOWNLOAD_FAILURE.test(line)) transient ??= line;
  }
  return transient;
}

/**
 * Run `attempt` (which returns `{ status, output }`) until it succeeds, it fails
 * for a reason that is not transient, or the retries in `delaysMs` run out.
 */
export async function retryTransientInstall(
  attempt,
  {
    label,
    delaysMs = INSTALL_RETRY_DELAYS_MS,
    sleep = (ms) => new Promise((settle) => setTimeout(settle, ms)),
    log = console.log,
  },
) {
  for (let retry = 0; ; retry += 1) {
    const { status, output } = attempt();
    if (status === 0) return;
    const reason = transientInstallFailure(output);
    if (!reason || retry >= delaysMs.length) {
      throw new Error(`${label} exited with status ${status}${reason ? ` after ${retry + 1} attempts` : ""}`);
    }
    log(
      `   ${label} hit a registry error (${reason}); retrying in ${delaysMs[retry] / 1000}s ` +
        `(retry ${retry + 1} of ${delaysMs.length})`,
    );
    await sleep(delaysMs[retry]);
  }
}

/**
 * Environment for npm and npx commands that publish to or install from the
 * local Verdaccio registry. npx caches a package by its spec, not by its
 * registry, so a local build of `@podosoft/podokit@<version>` installed through
 * the user's npm cache is what a later `npx @podosoft/podokit@<version>` runs,
 * as if it were the release. These commands therefore get a cache of their own.
 */
export function localRegistryEnvironment({ registry, userconfig, cacheDir }, base = process.env) {
  return {
    ...base,
    npm_config_registry: registry,
    npm_config_userconfig: userconfig,
    npm_config_cache: cacheDir,
  };
}
