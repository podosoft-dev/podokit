import { expect, test } from "@playwright/test";
import { ready } from "../helpers/hydration";
import { clearMailpit, mailpitReachable, waitForLink } from "../helpers/mailpit";

const base = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const origin = { origin: base };

// Verification badges/actions are gated by the emailVerification capability. The
// seeded suite runs with verification off, so assert the gating here (nothing
// leaks in); the enabled state is covered manually / under a verification run.
test("verification badges stay hidden when the feature is off", async ({ page }) => {
  await ready(page, "/admin/users");
  const caps = await (await page.request.get("/api/account/capabilities")).json();
  test.skip(caps.emailVerification === true, "email verification enabled");
  await expect(page.getByText("Verified", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Unverified", { exact: true })).toHaveCount(0);
});

// Admin can trigger a password-reset email for a user (not verification-gated).
test("admin sends a password reset email to a user", async ({ page }) => {
  test.skip(!(await mailpitReachable()), "Mailpit not available");
  await ready(page, "/admin/users");
  const email = `admin-reset-${Date.now()}@example.com`;
  await page.request.post("/api/auth/admin/create-user", {
    headers: { origin: base },
    data: { email, password: "password123", name: "AR", role: "user" },
  });
  await clearMailpit();
  await page.getByPlaceholder("Search by email…").fill(email);
  await page.getByRole("row", { name: new RegExp(email) }).getByRole("button").click();
  await page.getByRole("menuitem", { name: "Manage" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Security" }).click();
  await dialog.getByRole("button", { name: "Send password reset email" }).click();
  await expect(page.getByText("Password reset email sent")).toBeVisible();
  await waitForLink(email); // a reset email actually arrived for this user
});
