import { expect, test } from "@playwright/test";

test("admin sees the user list and can search @smoke", async ({ page }) => {
  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "admin@example.com" })).toBeVisible();
  await page.getByPlaceholder("Search by email…").fill("user@");
  await expect(page.getByRole("cell", { name: "user@example.com" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "admin@example.com" })).toHaveCount(0);
});

test("row menu exposes admin actions", async ({ page }) => {
  await page.goto("/admin/users");
  await page.getByPlaceholder("Search by email…").fill("user@example.com");
  const row = page.getByRole("row", { name: /user@example.com/ });
  await row.getByRole("button").click();
  await expect(page.getByRole("menuitem", { name: /Make admin|Make user/ })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Edit" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Impersonate" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Set password" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
});
