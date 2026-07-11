import { expect, test } from "@playwright/test";
import { anonState } from "../helpers/accounts";
import { totpCode } from "../helpers/totp";

test.use({ storageState: anonState });

const base = process.env.E2E_BASE_URL ?? "http://localhost:5001";
const origin = { origin: base };

// A disposable account (never the shared admin/user) so enabling 2FA here can't
// invalidate the seeded sessions the other auth specs rely on.
test("two-factor: sign in with a backup code from the login page @smoke", async ({ page, playwright }) => {
  const api = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  const caps = await (await api.get("/api/account/capabilities")).json();
  test.skip(!caps?.twoFactor, "two-factor not enabled");

  const email = `tf-ui-${Date.now()}@example.com`;
  const pw = "Podokit3e-Str0ng!pw";
  await api.post("/api/auth/sign-up/email", { data: { email, password: pw, name: "UI" } });
  const enable = await (await api.post("/api/auth/two-factor/enable", { data: { password: pw } })).json();
  await api.post("/api/auth/two-factor/verify-totp", { data: { code: totpCode(enable.totpURI) } });
  const backupCode = (enable.backupCodes as string[])[0]!;
  await api.dispose();

  // Password sign-in hands off to the second-factor step (no session yet).
  await page.goto(`/login?redirect=${encodeURIComponent("/admin/account")}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(pw);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  const step = page.getByTestId("two-factor-step");
  await expect(step).toBeVisible();

  // Switch to the backup-code input and complete the login.
  await page.getByRole("button", { name: "Use a backup code instead" }).click();
  await page.getByLabel("Backup code").fill(backupCode);
  await page.getByRole("button", { name: "Verify", exact: true }).click();

  await expect(page).toHaveURL(/\/admin\/account/);
});
