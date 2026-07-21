import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  createPhaseTimer,
  npmInstallArguments,
  playwrightArguments,
  resolveE2eOptions,
} from "./e2e-ci-lib.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outerTestRoots = [
  "templates/fullstack-nest-svelte/tests",
  "templates/modules/admin-dashboard/files/tests",
  "templates/modules/redis/files/tests",
  "templates/modules/bullmq/files/tests",
  "templates/modules/sse/files/tests",
  "templates/modules/file-upload/files/tests",
  "templates/modules/object-storage-s3/files/tests",
  "templates/modules/api-key-auth/files/tests",
  "templates/modules/job-progress/files/tests",
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

test("builds Playwright arguments only for browser modes", () => {
  assert.deepEqual(playwrightArguments({ mode: "full" }), ["playwright", "test"]);
  assert.deepEqual(playwrightArguments({ mode: "smoke" }), [
    "playwright",
    "test",
    "--grep",
    "@smoke",
  ]);
  assert.deepEqual(playwrightArguments({ mode: "full", grep: "account" }), [
    "playwright",
    "test",
    "--grep",
    "account",
  ]);
  assert.throws(() => playwrightArguments({ mode: "package-smoke" }), /does not run Playwright/);
});

test("uses a dedicated generated-app npm download cache when configured", () => {
  assert.deepEqual(npmInstallArguments(), ["install", "--no-audit", "--no-fund"]);
  assert.deepEqual(npmInstallArguments("/tmp/e2e-npm"), [
    "install",
    "--no-audit",
    "--no-fund",
    "--cache",
    "/tmp/e2e-npm",
  ]);
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

  assert.equal(smokeCount, 30);
  for (const requiredScenario of [
    "GET /health is public and ok @smoke",
    "two-factor: enable with a real TOTP code and require it at sign-in @smoke",
    "protected route redirects to login @smoke",
    "sidebar navigates to sessions and account @smoke",
    "inactive browser sessions are signed out automatically @smoke",
    "redis cache: set, get, and miss @smoke",
    "file upload: multipart upload returns a key and url @smoke",
  ]) {
    assert.match(source, new RegExp(requiredScenario.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
