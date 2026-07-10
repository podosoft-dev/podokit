import { expect, test } from "@playwright/test";
import { ready } from "../helpers/hydration";

// admin storageState (project default). The module-driven admin nav (F0-5
// registry) surfaces this module's entry and its admin page renders.
test("blog: admin nav entry and CRUD page @smoke", async ({ page }) => {
  await ready(page, "/admin");
  await expect(page.getByRole("link", { name: "Blog" })).toBeVisible();

  await ready(page, "/admin/blog");
  await expect(page.getByRole("heading", { name: "Blog" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New post" })).toBeVisible();
});
