import { defineConfig, devices } from "@playwright/test";
import { e2eRunSettings, e2eTrace, loadPlaywrightProjects, withExclusivePhase } from "./playwright.extensions";

// The suite runs against a live stack: web on E2E_BASE_URL (proxying /api/* to
// the API). Start it first (see docs/testing.md) — locally via the dev harness,
// in CI via scripts/e2e-ci.mjs. Two projects: `api` (request-only, backend e2e)
// and `ui` (chromium, pages). Files are routed by suffix (*.api/*.ui.spec.ts).
// E2E_WORKERS sets the worker count (default 1); tests tagged @exclusive run in
// `<project>-exclusive` twins after the others, in a second run when run-e2e.ts
// starts the suite on more workers (see playwright.extensions.ts). A failed test
// keeps its screenshot and error context under test-results/, and its trace when
// one was recorded: E2E_TRACE sets the trace mode (default on-first-retry on CI,
// off elsewhere), so rerun a failed file with E2E_TRACE=retain-on-failure.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5001";
const run = e2eRunSettings();
const coreProjects = [
  { name: "api", testMatch: /.*\.api\.spec\.ts/ },
  { name: "ui", testMatch: /.*\.ui\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
];

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: run.workers,
  outputDir: run.outputDir,
  globalSetup: "./playwright.extensions.ts",
  reporter: [["list"], ["html", { open: "never", outputFolder: run.reportFolder }]],
  use: {
    baseURL,
    trace: e2eTrace(),
    screenshot: "only-on-failure",
  },
  projects: withExclusivePhase([...coreProjects, ...loadPlaywrightProjects(coreProjects)], run.workers, run.phase),
});
