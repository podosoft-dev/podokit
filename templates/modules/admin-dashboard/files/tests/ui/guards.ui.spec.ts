import { expect, test } from "@playwright/test";
import { anonState, userState } from "../helpers/accounts";

test.describe("unauthenticated", () => {
  test.use({ storageState: anonState });
  test("protected route redirects to login @smoke", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?redirect=/);
  });
});

test.describe("normal user (non-admin)", () => {
  test.use({ storageState: userState });
  test("admin-only nav is hidden and admin routes are forbidden", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: "Users" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Sessions" })).toHaveCount(0);
    expect((await page.goto("/dashboard/users"))?.status()).toBe(403);
    expect((await page.goto("/dashboard/sessions"))?.status()).toBe(403);
  });
});
