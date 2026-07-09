import { defineConfig, devices } from "@playwright/test";

// The suite runs against a live stack: web on E2E_BASE_URL (proxying /api/* to
// the API). Start it first (see docs/testing.md) — locally via the dev harness,
// in CI via scripts/e2e-ci.mjs. Two projects: `api` (request-only, backend e2e)
// and `ui` (chromium, pages). Files are routed by suffix (*.api/*.ui.spec.ts).
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5001";

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "api", testMatch: /.*\.api\.spec\.ts/ },
    { name: "ui", testMatch: /.*\.ui\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
  ],
});
