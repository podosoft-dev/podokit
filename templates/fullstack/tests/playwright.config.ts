import { defineConfig, devices } from "@playwright/test";
import { e2eWorkers, loadPlaywrightProjects, withExclusivePhase } from "./playwright.extensions";

// The suite runs against a live stack: web on E2E_BASE_URL (proxying /api/* to
// the API). Start it first (see docs/testing.md) — locally via the dev harness,
// in CI via scripts/e2e-ci.mjs. Two projects: `api` (request-only, backend e2e)
// and `ui` (chromium, pages). Files are routed by suffix (*.api/*.ui.spec.ts).
// E2E_WORKERS sets the worker count (default 1); tests tagged @exclusive run in
// `<project>-exclusive` twins after the others (see playwright.extensions.ts).
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5001";
const workers = e2eWorkers();
const coreProjects = [
  { name: "api", testMatch: /.*\.api\.spec\.ts/ },
  { name: "ui", testMatch: /.*\.ui\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
];

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers,
  globalSetup: "./playwright.extensions.ts",
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: withExclusivePhase([...coreProjects, ...loadPlaywrightProjects(coreProjects)], workers),
});
