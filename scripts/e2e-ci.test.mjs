import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertCleanMigrationOutput,
  createPhaseTimer,
  INSTALL_RETRY_DELAYS_MS,
  localRegistryEnvironment,
  suiteArguments,
  playwrightWorkers,
  resolveE2eOptions,
  retryTransientInstall,
  transientInstallFailure,
} from "./e2e-ci-lib.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outerTestRoots = [
  "templates/fullstack/tests",
  "templates/modules/admin-dashboard/files/tests",
  "templates/modules/redis/files/tests",
  "templates/modules/bullmq/files/tests",
  "templates/modules/sse/files/tests",
  "templates/modules/file-upload/files/tests",
  "templates/modules/object-storage-s3/files/tests",
  "templates/modules/api-key-auth/files/tests",
  "templates/modules/job-progress/files/tests",
  "packages/podokit-module-analytics/files/tests",
  "packages/podokit-module-blog/files/tests",
];

function specFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return specFiles(path);
    return entry.name.endsWith(".spec.ts") ? [path] : [];
  });
}

test("resolves full, smoke, grep, and package-smoke modes", () => {
  assert.deepEqual(resolveE2eOptions([], {}), { mode: "full", grep: undefined, keep: false });
  assert.deepEqual(resolveE2eOptions(["--smoke"], { KEEP: "1" }), {
    mode: "smoke",
    grep: undefined,
    keep: true,
  });
  assert.deepEqual(resolveE2eOptions(["--grep", "account"], {}), {
    mode: "full",
    grep: "account",
    keep: false,
  });
  assert.deepEqual(resolveE2eOptions(["--package-smoke"], {}), {
    mode: "package-smoke",
    grep: undefined,
    keep: false,
  });
  assert.throws(
    () => resolveE2eOptions(["--package-smoke", "--smoke"], {}),
    /cannot be combined/,
  );
});

test("runs the suite through its runner only in browser modes", () => {
  assert.deepEqual(suiteArguments({ mode: "full" }), ["run-e2e.ts"]);
  assert.deepEqual(suiteArguments({ mode: "smoke" }), ["run-e2e.ts", "--grep", "@smoke"]);
  assert.deepEqual(suiteArguments({ mode: "full", grep: "account" }), ["run-e2e.ts", "--grep", "account"]);
  assert.throws(() => suiteArguments({ mode: "package-smoke" }), /does not run Playwright/);

  const source = readFileSync(join(repoRoot, "scripts/e2e-ci.mjs"), "utf8");
  assert.match(source, /run\("bun", testArgs, \{\n    cwd: join\(target, "tests"\),/);
});

test("runs only the full suite on more than one worker", () => {
  assert.equal(playwrightWorkers({ mode: "full" }, {}), "2");
  assert.equal(playwrightWorkers({ mode: "smoke" }, {}), "1");
  assert.equal(playwrightWorkers({ mode: "full", grep: "account" }, {}), "1");
  assert.equal(playwrightWorkers({ mode: "smoke" }, { E2E_WORKERS: "3" }), "3");

  const source = readFileSync(join(repoRoot, "scripts/e2e-ci.mjs"), "utf8");
  assert.match(source, /const workers = playwrightWorkers\(options\);/);
  assert.match(source, /E2E_WORKERS: workers,/);
});

test("tags every spec test that changes server-wide settings @exclusive", () => {
  const settingsWrite =
    /\.(?:put|post)\(\s*["'`]\/api\/(?:account\/settings|account\/auth-config|site\/settings|site\/favicon|admin\/analytics\/config)\b/;
  // These only check that the endpoint refuses the write.
  const refusals = new Set([
    "auth-config is admin-only and never leaks secrets @smoke",
    "only admins can change settings @smoke",
    "theme settings: invalid values are rejected (no CSS injection)",
  ]);
  const untagged = [];
  let tagged = 0;
  for (const file of outerTestRoots.flatMap((root) => specFiles(join(repoRoot, root)))) {
    const blocks = readFileSync(file, "utf8").split(/^(?=\s*test\()/m).slice(1);
    for (const block of blocks) {
      const firstLine = block.slice(0, block.indexOf("\n"));
      const title = /test\(\s*"([^"]+)"/.exec(firstLine)?.[1] ?? firstLine.trim();
      if (firstLine.includes('{ tag: "@exclusive" }')) tagged += 1;
      else if (settingsWrite.test(block) && !refusals.has(title)) untagged.push(`${relative(repoRoot, file)}: ${title}`);
    }
  }

  assert.deepEqual(untagged, []);
  assert.equal(tagged, 38);
});

test("publishes and installs external modules in the faithful generated app", () => {
  const source = readFileSync(join(repoRoot, "scripts/e2e-ci.mjs"), "utf8");
  const analytics = source.indexOf('packageName: "@podosoft/podokit-module-analytics"');
  const blog = source.indexOf('packageName: "@podosoft/podokit-module-blog"');
  const publish = source.indexOf("for (const pkg of PACKAGES)");
  const install = source.indexOf('"--dev"');
  const add = source.indexOf('external.name');

  assert.ok(analytics >= 0);
  assert.ok(blog >= 0);
  assert.ok(publish > analytics);
  assert.ok(publish > blog);
  assert.ok(install > publish);
  assert.ok(add > install);
});

test("publishes runtime providers before their generated app consumers", () => {
  const source = readFileSync(join(repoRoot, "scripts/e2e-ci.mjs"), "utf8");
  const contracts = source.indexOf('"@podosoft/podokit-contracts"');
  const runtime = source.indexOf('"@podosoft/podokit-runtime"');
  const auth = source.indexOf('"@podosoft/podokit-auth"');
  const cli = source.indexOf('"@podosoft/podokit"');

  assert.ok(contracts >= 0);
  assert.ok(runtime > contracts);
  assert.ok(auth > runtime);
  assert.ok(cli > runtime);
});

test("isolates Bun package resolution from previously published local packages", () => {
  const source = readFileSync(join(repoRoot, "scripts/e2e-ci.mjs"), "utf8");

  assert.match(
    source,
    /const bunCacheDir = process\.env\.E2E_BUN_CACHE[\s\S]*: join\(appDir, "\.bun-cache"\);/,
  );
  assert.equal(source.match(/"--cache-dir",\s*bunCacheDir/g)?.length, 2);
});

test("keeps local-registry packages out of the user's npm and npx cache", () => {
  const environment = localRegistryEnvironment(
    { registry: "http://localhost:4873", userconfig: "/tmp/run/.e2e-npmrc", cacheDir: "/tmp/run/.npm-cache" },
    { HOME: "/home/someone", npm_config_cache: "/home/someone/.npm" },
  );
  assert.deepEqual(environment, {
    HOME: "/home/someone",
    npm_config_cache: "/tmp/run/.npm-cache",
    npm_config_registry: "http://localhost:4873",
    npm_config_userconfig: "/tmp/run/.e2e-npmrc",
  });

  const source = readFileSync(join(repoRoot, "scripts/e2e-ci.mjs"), "utf8");
  // The run neither clears nor writes the user's ~/.npm/_npx.
  assert.doesNotMatch(source, /homedir\(\)|_npx/);
  assert.match(source, /const npmCacheDir = join\(appDir, "\.npm-cache"\);/);
  assert.match(source, /const npmEnv = localRegistryEnvironment\(\{ registry, userconfig: npmrc, cacheDir: npmCacheDir \}\);/);
  // Every npm or npx command that touches the local registry runs with that cache.
  const commands = source.match(/run\("np[mx]", \[[^\]]*\][^)]*\)/g) ?? [];
  const local = commands.filter((command) => /publish|@podosoft\/podokit/.test(command));
  assert.ok(local.length >= 5, `expected the publish and podokit commands, got ${local.length}`);
  for (const command of local) assert.match(command, /env: npmEnv/, command);
});

test("requires dependency readiness only when object storage is configured", () => {
  const source = readFileSync(join(repoRoot, "scripts/e2e-ci.mjs"), "utf8");

  assert.match(
    source,
    /const secondaryHealthPath = process\.env\.S3_ENDPOINT \? "\/health\/ready" : "\/health"/,
  );
  assert.match(source, /\$\{env\.SECONDARY_API_PORT\}\$\{secondaryHealthPath\}/);
});

test("downloads presigned objects only when the runner can reach the S3 endpoint", () => {
  const spec = readFileSync(
    join(repoRoot, "templates/modules/object-storage-s3/files/tests/api/storage.api.spec.ts"),
    "utf8",
  );

  assert.match(spec, /if \(process\.env\.S3_ENDPOINT\) \{\s+const download = await ctx\.get\(pre\.url\);/);
  assert.equal(spec.match(/ctx\.get\(pre\.url\)/g)?.length, 1);
});

test("downloads a completed chunked upload from S3 only when the runner can reach the endpoint", () => {
  const spec = readFileSync(
    join(repoRoot, "templates/modules/file-upload/files/tests/api/chunked-uploads.api.spec.ts"),
    "utf8",
  );

  // Local storage returns a signed API path, which the runner always downloads.
  assert.match(
    spec,
    /const local = result\.url\.startsWith\("\/"\);\s+if \(local \|\| process\.env\.S3_ENDPOINT\) \{\s+const download = await ctx\.get\(local \? `\$\{apiBase\}\$\{result\.url\}` : result\.url\);/,
  );
  assert.equal(spec.match(/ctx\.get\([^)]*result\.url/g)?.length, 1);
  assert.match(spec, /expect\(sha256\(stored\)\)\.toBe\(sha256\(file\)\);/);
});

test("preserves the audit-log module default in the generated app environment", () => {
  const source = readFileSync(join(repoRoot, "scripts/e2e-ci.mjs"), "utf8");

  assert.match(source, /"AUDIT_LOG_ENABLED=true"/);
  assert.match(source, /AUDIT_LOG_ENABLED: "true"/);
});

test("isolates rate-limit counters and aligns the server and test ceilings", () => {
  const source = readFileSync(join(repoRoot, "scripts/e2e-ci.mjs"), "utf8");

  assert.match(
    source,
    /const rateLimitMax = process\.env\.E2E_RATE_LIMIT_MAX \?\? "1000"/,
  );
  assert.match(
    source,
    /const rateLimitKeyPrefix = `podokit:e2e:\$\{process\.pid\}:\$\{Date\.now\(\)\}:rate-limit`/,
  );
  assert.match(source, /`RATE_LIMIT_KEY_PREFIX=\$\{rateLimitKeyPrefix\}`/);
  assert.match(source, /`RATE_LIMIT_MAX=\$\{rateLimitMax\}`/);
  assert.match(source, /RATE_LIMIT_KEY_PREFIX: rateLimitKeyPrefix/);
  assert.match(source, /RATE_LIMIT_MAX: rateLimitMax/);
  assert.match(source, /RATE_LIMIT_MAX: pgEnv\.RATE_LIMIT_MAX/);
});

test("records named phase durations and a total", () => {
  let clock = 0;
  const output = [];
  const timer = createPhaseTimer({ now: () => clock, log: (message) => output.push(message) });

  timer.start("build");
  clock = 1250;
  timer.start("test");
  clock = 1750;
  const phases = timer.finish();

  assert.deepEqual(phases, [
    { name: "build", elapsedMs: 1250 },
    { name: "test", elapsedMs: 500 },
  ]);
  assert.ok(output.some((line) => line.includes("1.8s") && line.includes("total")));
});

test("keeps the ready-PR smoke suite within its reviewed risk budget", () => {
  const source = outerTestRoots
    .flatMap((root) => specFiles(join(repoRoot, root)))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  const smokeCount = source.match(/@smoke/g)?.length ?? 0;

  assert.equal(smokeCount, 36);
  for (const requiredScenario of [
    "GET /health is public and ok @smoke",
    "GET /healthz answers from the web server without caching or indexing @smoke",
    "two-factor: enable with a real TOTP code and require it at sign-in @smoke",
    "protected route redirects to login @smoke",
    "protected app routes do not inherit the admin shell @smoke",
    "connected account unlink uses the local account row id @smoke",
    "admin route group is forbidden to non-admin users @smoke",
    "sidebar navigates to sessions and account @smoke",
    "inactive browser sessions are signed out automatically @smoke",
    "redis cache: set, get, and miss @smoke",
    "file upload: multipart upload returns a key and url @smoke",
    "public posts and comments use paginated envelopes @smoke",
    "blog list renders pagination-ready content @smoke",
  ]) {
    assert.match(source, new RegExp(requiredScenario.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("fails a migration run that reports a Better Auth schema mismatch", () => {
  assert.doesNotThrow(() => assertCleanMigrationOutput("$ bun scripts/run-migrations.mjs\n"));
  assert.throws(
    () => assertCleanMigrationOutput("ERROR [Better Auth]: Database schema mismatch\n\n  Missing tables\n"),
    /schema mismatch before migrating/,
  );

  const source = readFileSync(join(repoRoot, "scripts/e2e-ci.mjs"), "utf8");
  assert.match(source, /spawnSync\("bun", \["run", "--cwd", "apps\/api", "migrate:all"\]/);
  assert.match(source, /assertCleanMigrationOutput\(`\$\{migration\.stdout\}\$\{migration\.stderr\}`\)/);
});

// Bun 1.4 output from failed installs against the local registry.
const uplinkMiss = [
  "Resolved, downloaded and extracted [207]",
  "error: GET http://localhost:4873/json-bigint - 404",
  "error: json-bigint@^1.0.0 failed to resolve",
].join("\n");
const uplinkOffline = [
  "error: GET http://localhost:4873/protobufjs - 404",
  "",
  "error: GET http://localhost:4873/node-fetch - 404",
  "error: duplexify@^4.1.3 failed to resolve",
  "error: node-fetch@^3.3.2 failed to resolve",
].join("\n");
const missingLocalPackage = [
  "error: GET http://localhost:4873/@podosoft%2fpodokit-runtime - 404",
  "error: @podosoft/podokit-runtime@^0.4.1 failed to resolve",
].join("\n");
const missingVersion = [
  'error: No version matching "^9.0.0" found for specifier "@podosoft/podokit-runtime" (but package exists)',
  "error: @podosoft/podokit-runtime@^9.0.0 failed to resolve",
].join("\n");

test("retries installs only after registry or network failures", () => {
  assert.equal(transientInstallFailure(uplinkMiss), "error: GET http://localhost:4873/json-bigint - 404");
  assert.equal(transientInstallFailure(uplinkOffline), "error: GET http://localhost:4873/protobufjs - 404");
  assert.ok(transientInstallFailure("error: GET http://localhost:4873/zod - 503"));
  assert.ok(transientInstallFailure("error: GET http://localhost:4873/zod - 429"));
  for (const name of ["ConnectionRefused", "ConnectionClosed", "DNSResolveFailed"]) {
    assert.ok(transientInstallFailure(`error: ${name} downloading package manifest zod`), name);
  }
  assert.ok(transientInstallFailure("error: ConnectionClosed downloading tarball zod@4.1.0"));

  assert.equal(transientInstallFailure(missingLocalPackage), null);
  assert.equal(transientInstallFailure(missingVersion), null);
  assert.equal(transientInstallFailure(`${uplinkMiss}\n${missingVersion}`), null);
  assert.equal(transientInstallFailure(`${uplinkMiss}\n${missingLocalPackage}`), null);
  assert.equal(transientInstallFailure("error: GET http://localhost:4873/zod - 401"), null);
  assert.equal(transientInstallFailure("error: workspace dependency \"web\" not found"), null);
  assert.equal(transientInstallFailure(""), null);
});

test("retries a transient install failure a bounded number of times", async () => {
  const waits = [];
  const logs = [];
  const results = [
    { status: 1, output: uplinkMiss },
    { status: 1, output: uplinkOffline },
    { status: 0, output: "1013 packages installed" },
  ];
  let attempts = 0;
  await retryTransientInstall(() => results[attempts++], {
    label: "bun install",
    sleep: async (ms) => waits.push(ms),
    log: (line) => logs.push(line),
  });

  assert.equal(attempts, 3);
  assert.deepEqual(waits, INSTALL_RETRY_DELAYS_MS);
  assert.match(logs[0], /bun install hit a registry error \(error: GET http:\/\/localhost:4873\/json-bigint - 404\); retrying in 10s \(retry 1 of 2\)/);

  attempts = 0;
  await assert.rejects(
    retryTransientInstall(() => (attempts++, { status: 1, output: uplinkMiss }), {
      label: "bun install",
      sleep: async () => {},
      log: () => {},
    }),
    /bun install exited with status 1 after 3 attempts/,
  );
  assert.equal(attempts, 3);
});

test("does not retry an install that failed to resolve a real dependency", async () => {
  let attempts = 0;
  await assert.rejects(
    retryTransientInstall(() => (attempts++, { status: 1, output: missingVersion }), {
      label: "bun install",
      sleep: async () => assert.fail("must not wait"),
      log: () => {},
    }),
    /^Error: bun install exited with status 1$/,
  );
  assert.equal(attempts, 1);
});

test("installs the faithful app through the retrying Bun runner", () => {
  const source = readFileSync(join(repoRoot, "scripts/e2e-ci.mjs"), "utf8");

  assert.match(source, /await bunInstallWithRetries\(\["install", "--cache-dir", bunCacheDir\]/);
  assert.match(source, /await bunInstallWithRetries\(\s*\[\s*"add",\s*"--dev",\s*external\.packageName/);
  assert.doesNotMatch(source, /run\("bun", \["install"/);
  assert.doesNotMatch(source, /run\(\s*"bun",\s*\[\s*"add"/);
});

test("lets Verdaccio ask npm again before the first install retry", () => {
  const config = readFileSync(join(repoRoot, "scripts/verdaccio.yaml"), "utf8");
  const failTimeout = /^\s+fail_timeout: (\d+)s$/m.exec(config);

  assert.ok(failTimeout, "the npm uplink sets fail_timeout in seconds");
  assert.ok(Number(failTimeout[1]) * 1000 < INSTALL_RETRY_DELAYS_MS[0]);
});
