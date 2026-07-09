import { expect, test } from "@playwright/test";
import { ready } from "../helpers/hydration";

// admin storageState (project default) — organizations is an admin-only view
test("admin can create an organization @smoke", async ({ page }) => {
  await ready(page, "/admin");
  const nav = page.getByRole("link", { name: "Organizations" });
  test.skip((await nav.count()) === 0, "organizations not enabled");
  await nav.click();
  await expect(page).toHaveURL(/\/admin\/organizations/);
  await page.getByRole("button", { name: "New organization" }).click();
  const name = `Acme ${Date.now()}`;
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("dialog").getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("Organization created")).toBeVisible();
  await expect(page.getByRole("cell", { name })).toBeVisible();
  // clean up so the shared admin account keeps no leftover org
  await page.getByRole("row", { name: new RegExp(name) }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Organization deleted")).toBeVisible();
});
