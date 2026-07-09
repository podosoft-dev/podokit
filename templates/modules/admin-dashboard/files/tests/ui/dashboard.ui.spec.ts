import { expect, test } from "@playwright/test";
import { ADMIN } from "../helpers/accounts";
import { ready } from "../helpers/hydration";

// admin storageState (project default)
test("overview shows the signed-in admin @smoke", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  // email appears in the sidebar user menu too — scope to the main content.
  await expect(page.getByRole("main").getByText(ADMIN.email)).toBeVisible();
});

test("sidebar navigates to sessions and account", async ({ page }) => {
  await ready(page, "/admin");
  await page.getByRole("link", { name: "Sessions" }).click();
  await expect(page).toHaveURL(/\/admin\/sessions/);
  await expect(page.getByRole("heading", { name: "User sessions" })).toBeVisible();
  // Account is reached from the user menu at the bottom of the sidebar, not the nav
  await expect(page.getByRole("link", { name: "Account" })).toHaveCount(0);
  await page.getByRole("button", { name: /admin@example.com/ }).click();
  await page.getByRole("menuitem", { name: "Account" }).click();
  await expect(page).toHaveURL(/\/admin\/account/);
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toBeVisible(); // profile section (exact: "Username" also contains "Name")
});
