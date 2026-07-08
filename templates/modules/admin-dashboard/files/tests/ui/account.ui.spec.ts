import { expect, test } from "@playwright/test";
import { ready } from "../helpers/hydration";

// admin storageState (project default)
test("account opens on the profile section @smoke", async ({ page }) => {
  await ready(page, "/admin/account");
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue("admin@example.com");
  // save is enabled only once the name changes
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await page.getByLabel("Name", { exact: true }).fill("Admin Renamed");
  await expect(page.getByRole("button", { name: "Save changes" })).toBeEnabled();
});

test("account exposes a change-email action when the address is edited @smoke", async ({ page }) => {
  await ready(page, "/admin/account");
  const email = page.getByLabel("Email");
  await expect(email).toHaveValue("admin@example.com");
  // no action until the address actually changes
  await expect(page.getByRole("button", { name: "Change email" })).toHaveCount(0);
  await email.fill("admin+changed@example.com");
  await expect(page.getByRole("button", { name: "Change email" })).toBeVisible();
  // revert without submitting — don't mutate the shared admin session
  await email.fill("admin@example.com");
  await expect(page.getByRole("button", { name: "Change email" })).toHaveCount(0);
});

test("account shows a username field when enabled @smoke", async ({ page }) => {
  await ready(page, "/admin/account");
  const username = page.getByLabel("Username", { exact: true });
  test.skip((await username.count()) === 0, "username not enabled");
  await expect(username).toBeVisible();
});

test("account shows a phone field when enabled @smoke", async ({ page }) => {
  await ready(page, "/admin/account");
  const phone = page.getByLabel("Phone number", { exact: true });
  test.skip((await phone.count()) === 0, "phone number not enabled");
  await expect(phone).toBeVisible();
});

test("admin can update their profile name", async ({ page }) => {
  await ready(page, "/admin/account");
  await page.getByLabel("Name", { exact: true }).fill("Admin Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Profile updated")).toBeVisible();
});

test("account security and sessions sub-navigation", async ({ page }) => {
  await ready(page, "/admin/account");
  await page.getByRole("button", { name: "Security" }).click();
  await expect(page.getByLabel("Current password")).toBeVisible();
  await page.getByRole("button", { name: "Sessions" }).click();
  await expect(page.getByText("Active sessions")).toBeVisible();
  await expect(page.getByText("Current", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out other sessions" })).toBeVisible();
});

test("account nav shows the core sections", async ({ page }) => {
  await ready(page, "/admin/account");
  await expect(page.getByRole("button", { name: "Profile" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Security" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sessions" })).toBeVisible();
});

test("two-factor setup shows a scannable QR code when enabled @smoke", async ({ page }) => {
  await ready(page, "/admin/account");
  await page.getByRole("button", { name: "Security" }).click();
  const heading = page.getByText("Two-factor authentication");
  test.skip((await heading.count()) === 0, "two-factor not enabled");
  await expect(page.getByRole("button", { name: "Enable", exact: true })).toBeVisible();
  // Start setup (password + Enable) and confirm the QR renders. Stop before
  // verifying so 2FA stays inactive and the shared admin session keeps working.
  await page.locator("#tf-on-pw").fill("Podokit3e-Str0ng!pw");
  await page.getByRole("button", { name: "Enable", exact: true }).click();
  await expect(page.getByRole("img", { name: "TOTP QR code" })).toBeVisible();
});

test("danger zone offers account deletion when enabled", async ({ page }) => {
  await ready(page, "/admin/account");
  const danger = page.getByRole("button", { name: "Danger zone" });
  test.skip((await danger.count()) === 0, "account deletion not enabled");
  await danger.click();
  await expect(page.getByRole("button", { name: "Delete account" })).toBeVisible();
});
