import { expect, test } from "@playwright/test";
import { ready } from "../helpers/hydration";

// admin storageState (project default). Proves the module-driven admin nav
// (F0-5 registry) surfaces this module's entry and its admin page renders.
test("collections: admin nav entry and CRUD page @smoke", async ({ page }) => {
  await ready(page, "/admin");
  await expect(page.getByRole("link", { name: "Collections" })).toBeVisible();

  await ready(page, "/admin/collections");
  await expect(page.getByRole("heading", { name: "Collections" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add item" })).toBeVisible();
});
