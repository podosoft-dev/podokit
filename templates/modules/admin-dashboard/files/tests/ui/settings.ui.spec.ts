import { expect, test } from "@playwright/test";
import { ready } from "../helpers/hydration";

// admin storageState (project default)
test("settings lists the auth features and their status @smoke", async ({ page }) => {
  await ready(page, "/admin/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("Email & password")).toBeVisible();
  await expect(page.getByText("Two-factor authentication")).toBeVisible();
  await expect(page.getByText("Breached-password check")).toBeVisible();
  await expect(page.getByText("Magic link")).toBeVisible();
  // each feature carries an explicit status
  await expect(page.getByText("Enabled", { exact: true }).first()).toBeVisible();
});

test("settings is reachable from the sidebar @smoke", async ({ page }) => {
  await ready(page, "/admin");
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/admin\/settings/);
});
