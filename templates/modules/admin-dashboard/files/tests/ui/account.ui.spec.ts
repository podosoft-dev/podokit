import { expect, test } from "@playwright/test";
import { ready } from "../helpers/hydration";

// admin storageState (project default)
test("account opens on the profile section @smoke", async ({ page }) => {
  await ready(page, "/dashboard/account");
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
  await expect(page.getByLabel("Name")).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue("admin@example.com");
  // save is enabled only once the name changes
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await page.getByLabel("Name").fill("Admin Renamed");
  await expect(page.getByRole("button", { name: "Save changes" })).toBeEnabled();
});

test("admin can update their profile name", async ({ page }) => {
  await ready(page, "/dashboard/account");
  await page.getByLabel("Name").fill("Admin Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Profile updated")).toBeVisible();
});

test("account security and sessions sub-navigation", async ({ page }) => {
  await ready(page, "/dashboard/account");
  await page.getByRole("button", { name: "Security" }).click();
  await expect(page.getByLabel("Current password")).toBeVisible();
  await page.getByRole("button", { name: "Sessions" }).click();
  await expect(page.getByText("Active sessions")).toBeVisible();
  await expect(page.getByText("Current", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out other sessions" })).toBeVisible();
});

test("account nav shows the core sections", async ({ page }) => {
  await ready(page, "/dashboard/account");
  await expect(page.getByRole("button", { name: "Profile" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Security" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sessions" })).toBeVisible();
});

test("two-factor setup is available when enabled", async ({ page }) => {
  await ready(page, "/dashboard/account");
  await page.getByRole("button", { name: "Security" }).click();
  const heading = page.getByText("Two-factor authentication");
  test.skip((await heading.count()) === 0, "two-factor not enabled");
  await expect(heading).toBeVisible();
  await expect(page.getByRole("button", { name: "Enable" })).toBeVisible();
});

test("danger zone offers account deletion when enabled", async ({ page }) => {
  await ready(page, "/dashboard/account");
  const danger = page.getByRole("button", { name: "Danger zone" });
  test.skip((await danger.count()) === 0, "account deletion not enabled");
  await danger.click();
  await expect(page.getByRole("button", { name: "Delete account" })).toBeVisible();
});
