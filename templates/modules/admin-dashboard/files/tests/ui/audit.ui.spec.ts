import { expect, test } from "@playwright/test";
import { ready } from "../helpers/hydration";

// admin storageState (project default). The Audit log page is gated by the
// audit-log module; skip when it isn't installed in the generated app.
test("admin can view the audit log when the module is installed", async ({ page }) => {
  await ready(page, "/admin");
  const auditNav = page.getByRole("link", { name: "Audit log" });
  test.skip((await auditNav.count()) === 0, "audit-log module not installed");

  await auditNav.click();
  await expect(page).toHaveURL(/\/admin\/audit/);
  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
  // the table header renders (entries may or may not be present)
  await expect(page.getByRole("columnheader", { name: "Path" })).toBeVisible();
});
