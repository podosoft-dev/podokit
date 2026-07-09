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
  await expect(page.getByText("Organization created").first()).toBeVisible();
  await expect(page.getByRole("cell", { name })).toBeVisible();
  // clean up so the shared admin account keeps no leftover org
  await page.getByRole("row", { name: new RegExp(name) }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Organization deleted").first()).toBeVisible();
});

test("create an org with a non-ascii name, a parent, and a manager @smoke", async ({ page }) => {
  await ready(page, "/admin/organizations");
  const newBtn = page.getByRole("button", { name: "New organization" });
  test.skip((await newBtn.count()) === 0, "organizations not enabled");

  // Parent org first (Korean name → slug falls back, so it still saves).
  const parent = `본사 ${Date.now()}`;
  await newBtn.click();
  await page.getByLabel("Name", { exact: true }).fill(parent);
  await page.getByRole("dialog").getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("Organization created").first()).toBeVisible();
  await expect(page.getByRole("cell", { name: parent })).toBeVisible();

  // Child org: pick the parent + a manager (an existing user).
  const child = `영업 ${Date.now()}`;
  await page.getByRole("button", { name: "New organization" }).click();
  await page.getByLabel("Name", { exact: true }).fill(child);
  await page.locator("#o-parent").click();
  await page.getByRole("option", { name: parent }).click();
  await page.getByRole("checkbox").first().click(); // first existing user as a manager
  await page.getByRole("dialog").getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("Organization created").first()).toBeVisible();
  // child row shows the parent org name
  await expect(page.getByRole("row", { name: new RegExp(child) })).toContainText(parent);

  // clean up both
  for (const n of [child, parent]) {
    await page.getByRole("row", { name: new RegExp(n) }).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Organization deleted").first()).toBeVisible();
  }
});
