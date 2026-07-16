import { expect, test } from "@playwright/test";
import { anonState, ADMIN } from "../helpers/accounts";
import { ready } from "../helpers/hydration";

test.use({ storageState: anonState });

const base = process.env.E2E_BASE_URL ?? "http://localhost:5001";

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

test("pending approval errors show the approval status page", async ({ page }) => {
  await page.goto("/login?error=SIGNUP_APPROVAL_REQUIRED");
  await expect(page).toHaveURL(/\/pending-approval$/);
  await expect(page.getByRole("heading", { name: "Waiting for approval" })).toBeVisible();
});

test("configured social providers appear on the login page", async ({ page, playwright }) => {
  const admin = await playwright.request.newContext({
    baseURL: base,
    extraHTTPHeaders: { origin: base },
  });
  await admin.post("/api/auth/sign-in/email", {
    data: { email: ADMIN.email, password: ADMIN.password },
  });
  try {
    expect(
      (await admin.put("/api/account/auth-config", {
        data: {
          social: {
            google: {
              enabled: true,
              clientId: "dummy-google-client-id",
              clientSecret: "dummy-google-client-secret",
            },
          },
        },
      })).ok(),
    ).toBeTruthy();
    await expect
      .poll(async () => {
        await page.goto("/login");
        return page.getByRole("button", { name: "Continue with Google" }).count();
      }, { timeout: 8_000 })
      .toBe(1);
  } finally {
    await admin.put("/api/account/auth-config", {
      data: { social: { google: { enabled: false } } },
    });
    await admin.dispose();
  }
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

test("signup creates an account and enters the app @smoke", async ({ page }) => {
  await ready(page, "/signup");
  const email = `signup-${Date.now()}@example.com`;
  await page.getByLabel("Name").fill("New User");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Podokit3e-Str0ng!pw");
  await page.getByRole("button", { name: "Create account" }).click();
  // Verification off → straight into the app; on → the verify-email page.
  await expect(page).toHaveURL(/\/admin|\/verify-email/);
});
