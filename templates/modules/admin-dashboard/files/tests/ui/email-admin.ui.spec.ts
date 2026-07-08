import { expect, test } from "@playwright/test";
import { ready } from "../helpers/hydration";

// Email-verification surfacing in the admin console is gated by the
// `emailVerification` capability. The seeded suite runs with verification off,
// so here we assert the gating (no verification badges leak in). The enabled
// state is covered manually / under a verification-enabled run.
test("verification badges stay hidden when the feature is off", async ({ page }) => {
  await ready(page, "/admin/users");
  const caps = await (await page.request.get("/api/account/capabilities")).json();
  test.skip(caps.emailVerification === true, "email verification enabled");
  await expect(page.getByText("Verified", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Unverified", { exact: true })).toHaveCount(0);
});
