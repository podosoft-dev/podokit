import { defineConfig, devices } from "@playwright/test";

// admin-dashboard overlay: adds a `setup` project that seeds admin/user sessions
// (storageState) which the `ui` project reuses. Serial + single worker because
// tests share one backend/DB. Runs against a live stack on E2E_BASE_URL.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";

export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL, trace: "on-first-retry", screenshot: "only-on-failure" },
  projects: [
    { name: "api", testMatch: /.*\.api\.spec\.ts/, dependencies: ["setup"] },
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "ui",
      testMatch: /.*\.ui\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/admin.json" },
    },
  ],
});
