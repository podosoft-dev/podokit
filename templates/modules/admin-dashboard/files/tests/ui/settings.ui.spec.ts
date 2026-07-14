import { expect, test, type Page } from "@playwright/test";
import { ready } from "../helpers/hydration";

// admin storageState (project default)

async function saveGeneral(page: Page): Promise<void> {
  const saved = page.waitForResponse(
    (response) => response.url().endsWith("/api/site/settings") && response.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "Save changes" }).click();
  expect((await saved).ok()).toBeTruthy();
  await expect(page.getByText("General settings saved.").last()).toBeVisible();
}

test("settings has General and Authentication tabs @smoke", async ({ page }) => {
  await ready(page, "/admin/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "General" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Authentication" })).toBeVisible();
  // General is the default tab: the site name field is shown.
  await expect(page.getByLabel("Site name")).toBeVisible();
});

test("general settings: shows the favicon uploader @smoke", async ({ page }) => {
  await ready(page, "/admin/settings");
  await expect(page.getByText("Browser icon (favicon)")).toBeVisible();
  await expect(page.locator('input[type="file"]')).toBeVisible();
});

test("general settings: edit the site name, save, and apply live @smoke", async ({ page }) => {
  await ready(page, "/admin/settings");
  const name = page.getByLabel("Site name");
  const original = await name.inputValue();
  await name.fill("PodoKit Test Site");
  await saveGeneral(page);
  // the browser tab title reflects the new name live (no reload)
  await expect(page).toHaveTitle("PodoKit Test Site");
  // restore so other specs start clean
  await name.fill(original);
  await saveGeneral(page);
});

test("settings lists the auth features under the Authentication tab @smoke", async ({ page }) => {
  await ready(page, "/admin/settings");
  await page.getByRole("tab", { name: "Authentication" }).click();
  await expect(page.getByText("Email & password")).toBeVisible();
  await expect(page.getByText("Two-factor authentication")).toBeVisible();
  await expect(page.getByText("Breached-password check")).toBeVisible();
  await expect(page.getByText("Magic link")).toBeVisible();
  // each feature carries an explicit status
  await expect(page.getByText("Enabled", { exact: true }).first()).toBeVisible();
});

test("sidebar: back-to-home link returns to the landing page @smoke", async ({ page }) => {
  await ready(page, "/admin/settings");
  // the home link lives in the sidebar footer, above the user menu
  await page.getByRole("link", { name: "Back to home" }).click();
  await expect(page).toHaveURL(/\/$/);
  // Landing routes are app-owned, so only verify the shared page shell.
  await expect(page.locator("main").first()).toBeVisible();
});

test("settings is reachable from the sidebar @smoke", async ({ page }) => {
  await ready(page, "/admin");
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/admin\/settings/);
});

test("admin can toggle a feature flag and it applies live @smoke", async ({ page }) => {
  await ready(page, "/admin/settings");
  await page.getByRole("tab", { name: "Authentication" }).click();
  const toggle = page.getByRole("switch", { name: "Magic link" });
  test.skip((await toggle.count()) === 0, "magic link toggle not present");
  // Serial workers (workers:1) make toggle-then-restore safe for other specs.
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(page.getByText("Setting updated")).toBeVisible();
  await expect(toggle).not.toBeChecked(); // capabilities refreshed live
  // restore so the shared magic-link/2FA specs keep their expected state
  await toggle.click();
  await expect(toggle).toBeChecked();
});

test("settings: the require-two-factor toggle is available @smoke", async ({ page }) => {
  await ready(page, "/admin/settings");
  await page.getByRole("tab", { name: "Authentication" }).click();
  // The policy toggle renders under Authentication; its enforcement is covered by
  // the require-2fa api/ui specs. Not toggled here — turning it on would gate this
  // admin session.
  await expect(page.getByRole("switch", { name: "Require two-factor" })).toBeVisible();
});
