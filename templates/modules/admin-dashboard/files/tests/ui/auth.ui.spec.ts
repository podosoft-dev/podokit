import { expect, test } from "@playwright/test";
import { anonState, ADMIN } from "../helpers/accounts";
import { ready } from "../helpers/hydration";

test.use({ storageState: anonState });

test("login page renders @smoke", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign up" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Forgot?" })).toBeVisible();
});

test("invalid credentials show an error", async ({ page }) => {
  await ready(page, "/login");
  await page.getByLabel("Email").fill("nobody@example.com");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("signup page renders", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByLabel("Name")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
});

test("forgot-password shows a sent confirmation", async ({ page }) => {
  await ready(page, "/forgot-password");
  // Retry the submit to absorb any first-load hydration timing.
  await expect(async () => {
    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
});

test("reset-password without a token is disabled", async ({ page }) => {
  await page.goto("/reset-password");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Update password" })).toBeDisabled();
});
