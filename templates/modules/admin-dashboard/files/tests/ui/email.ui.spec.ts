import { expect, test } from "@playwright/test";
import { anonState } from "../helpers/accounts";
import { ready } from "../helpers/hydration";
import { clearMailpit, mailpitReachable, waitForLink } from "../helpers/mailpit";

const base = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const origin = { origin: base };

// The reset flow is for signed-out users — run without the seeded session.
test.use({ storageState: anonState });

test("forgot password: request, open the emailed link, set a new password, sign in @smoke", async ({ page, playwright }) => {
  test.skip(!(await mailpitReachable()), "Mailpit not available");
  const email = `ui-reset-${Date.now()}@example.com`;
  const ctx = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  const signup = await ctx.post("/api/auth/sign-up/email", { data: { email, password: "password123", name: "UIReset" } });
  expect(signup.ok()).toBeTruthy();
  const verificationOn = !(await signup.json())?.token;
  await ctx.dispose();
  // The happy path ends by signing in; when verification is required that would be
  // blocked, so this UI walkthrough only applies with verification off.
  test.skip(verificationOn, "email verification enabled");
  await clearMailpit();

  await ready(page, "/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText(/reset link is on its way/i)).toBeVisible();

  // Open the emailed link: the API validates it and redirects to the reset page.
  await page.goto(await waitForLink(email));
  await page.waitForLoadState("load");
  await page.waitForTimeout(400);
  await page.getByLabel("New password").fill("newpass1234");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("newpass1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin/);
});
