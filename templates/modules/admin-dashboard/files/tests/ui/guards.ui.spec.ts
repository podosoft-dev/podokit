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
  test("Users nav is hidden and /dashboard/users is forbidden", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: "Users" })).toHaveCount(0);
    const res = await page.goto("/dashboard/users");
    expect(res?.status()).toBe(403);
  });
});
