import { expect, test } from "@playwright/test";
import { ready } from "../helpers/hydration";

// admin storageState (project default) — sessions is an admin-only view
test("admin sees user sessions across users @smoke", async ({ page }) => {
  await ready(page, "/admin/sessions");
  await expect(page.getByRole("heading", { name: "User sessions" })).toBeVisible();
  // another user's session is listed here (the across-users admin view); scope to
  // the table, not the sidebar, and match the first row.
  await expect(page.getByRole("main").getByText("user@example.com").first()).toBeVisible();
  // row actions are available
  await page.getByRole("row", { name: /user@example.com/ }).first().getByRole("button").click();
  await expect(page.getByRole("menuitem", { name: "Revoke session" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Revoke all for user" })).toBeVisible();
});
