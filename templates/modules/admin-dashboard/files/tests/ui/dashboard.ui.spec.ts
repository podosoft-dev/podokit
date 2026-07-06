import { expect, test } from "@playwright/test";
import { ADMIN } from "../helpers/accounts";

// admin storageState (project default)
test("overview shows the signed-in admin @smoke", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  // email appears in the sidebar user menu too — scope to the main content.
  await expect(page.getByRole("main").getByText(ADMIN.email)).toBeVisible();
});

test("sidebar navigates to sessions and account", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Sessions" }).click();
  await expect(page).toHaveURL(/\/dashboard\/sessions/);
  await expect(page.getByRole("heading", { name: "Active sessions" })).toBeVisible();
  await page.getByRole("link", { name: "Account" }).click();
  await expect(page).toHaveURL(/\/dashboard\/account/);
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
  await expect(page.getByText("Change password")).toBeVisible();
});
