import { expect, test } from "@playwright/test";
import { ready } from "../helpers/hydration";

// admin storageState (project default)
test("account shows my active sessions with a current badge @smoke", async ({ page }) => {
  await ready(page, "/dashboard/account");
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
  await expect(page.getByText("Active sessions")).toBeVisible(); // sessions card
  await expect(page.getByText("Current", { exact: true })).toBeVisible(); // current-session badge
  await expect(page.getByRole("button", { name: "Sign out other sessions" })).toBeVisible();
});
