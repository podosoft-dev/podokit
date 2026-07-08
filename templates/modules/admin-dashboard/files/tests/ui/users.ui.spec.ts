import { expect, test } from "@playwright/test";
import { ready } from "../helpers/hydration";

test("admin sees the user list and can search @smoke", async ({ page }) => {
  await ready(page, "/admin/users");
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  // Search by exact address — robust to pagination as the user count grows.
  await page.locator("#toolbar-search").fill("admin@example.com");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("cell", { name: "admin@example.com" })).toBeVisible();
  await page.locator("#toolbar-search").fill("user@example.com");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("cell", { name: "user@example.com" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "admin@example.com" })).toHaveCount(0);
});

test("row menu exposes admin actions", async ({ page }) => {
  await page.goto("/admin/users");
  await page.locator("#toolbar-search").fill("user@example.com");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const row = page.getByRole("row", { name: /user@example.com/ });
  await row.getByRole("button").click();
  await expect(page.getByRole("menuitem", { name: "Manage" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Impersonate" })).toBeVisible();
});
