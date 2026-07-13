import { expect, test } from "@playwright/test";
import { anonState, userState } from "../helpers/accounts";

test.describe("unauthenticated", () => {
  test.use({ storageState: anonState });
  test("protected route redirects to login @smoke", async ({ page }) => {
    for (const route of ["/admin", "/account"]) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login\?redirect=/);
    }
  });

  test("private and authentication routes prevent search indexing @smoke", async ({ request }) => {
    for (const route of ["/admin", "/account", "/login", "/api/account/me"]) {
      const response = await request.get(route, { maxRedirects: 0 });
      expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    }

    const landing = await request.get("/");
    expect(landing.headers()["x-robots-tag"]).toBeUndefined();
  });
});

test.describe("normal user (non-admin)", () => {
  test.use({ storageState: userState });
  test("admin-only nav is hidden and admin routes are forbidden", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByRole("link", { name: "Users" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Sessions" })).toHaveCount(0);
    expect((await page.goto("/admin/users"))?.status()).toBe(403);
    expect((await page.goto("/admin/sessions"))?.status()).toBe(403);
    expect((await page.goto("/admin/settings"))?.status()).toBe(403);
  });

  test("account is available without the admin shell @smoke", async ({ page }) => {
    await page.goto("/account");
    await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
    await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Overview" })).toHaveCount(0);
  });
});
