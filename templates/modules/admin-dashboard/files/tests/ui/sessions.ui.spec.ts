import { expect, test } from "@playwright/test";
import { ready } from "../helpers/hydration";

// admin storageState (project default) — sessions is an admin-only view
test("admin sees user sessions across users @smoke", async ({ page }) => {
  await ready(page, "/dashboard/sessions");
  await expect(page.getByRole("heading", { name: "User sessions" })).toBeVisible();
  // the admin's own session is listed (email scoped to the table, not the sidebar;
  // the admin may have several sessions, so match the first row)
  await expect(page.getByRole("main").getByText("admin@example.com").first()).toBeVisible();
  // row actions are available
  await page.getByRole("row", { name: /admin@example.com/ }).first().getByRole("button").click();
  await expect(page.getByRole("menuitem", { name: "Revoke session" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Revoke all for user" })).toBeVisible();
});
