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

export function playwrightArguments({ mode, grep }) {
  if (mode === "package-smoke") {
    throw new Error("package-smoke does not run Playwright");
  }
  return [
    "playwright",
    "test",
    ...(grep ? ["--grep", grep] : mode === "smoke" ? ["--grep", "@smoke"] : []),
  ];
}

export function npmInstallArguments(cacheDirectory) {
  return [
    "install",
    "--no-audit",
    "--no-fund",
    ...(cacheDirectory ? ["--cache", cacheDirectory] : []),
  ];
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
