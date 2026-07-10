import { expect, test } from "@playwright/test";
import { ready } from "../helpers/hydration";

// admin storageState (project default). The module-driven admin nav surfaces
// this module's entry and its admin page renders.
test("faq: admin nav entry and CRUD page @smoke", async ({ page }) => {
  await ready(page, "/admin");
  await expect(page.getByRole("link", { name: "FAQ" })).toBeVisible();

  await ready(page, "/admin/faq");
  await expect(page.getByRole("heading", { name: "FAQ" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add question" })).toBeVisible();
});
