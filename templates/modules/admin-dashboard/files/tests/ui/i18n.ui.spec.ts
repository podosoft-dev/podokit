import { expect, test } from "@playwright/test";
import { anonState } from "../helpers/accounts";
import { ready } from "../helpers/hydration";

test.use({ storageState: anonState });

test("language switch toggles Korean and sets <html lang>", async ({ page }) => {
  await ready(page, "/login");
  await page.getByRole("button", { name: "Language" }).click();
  await page.getByRole("menuitem", { name: /한국어/ }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await expect(page.getByRole("button", { name: "로그인", exact: true })).toBeVisible();
});
