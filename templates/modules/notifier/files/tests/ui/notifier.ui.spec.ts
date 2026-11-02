import { expect, test } from "@playwright/test";
import { seededAdmin } from "../helpers/seeded-admin";

// admin storageState (admin-dashboard project default). The Operator
// notifications tab saves a webhook pointed at the dev sink, then the test
// button shows each channel's result.
const SINK = process.env.SMS_SINK_URL ?? "http://localhost:8095";

async function sinkReady(): Promise<boolean> {
  try {
    return (await fetch(`${SINK}/readyz`)).ok;
  } catch {
    return false;
  }
}

test("operator notifications tab saves a webhook and shows test results", { tag: "@exclusive" }, async ({ page }) => {
  test.skip(!(await seededAdmin()), "requires the admin-dashboard module");
  test.skip(!(await sinkReady()), `no sink answers at ${SINK}`);
  // Loaded here: admin-dashboard installs the hydration helper.
  const { ready } = await import("../helpers/hydration");
  const hookName = `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    await ready(page, "/admin/settings");
    await page.getByRole("tab", { name: "Notifications" }).click();
    const panel = page.getByTestId("notifier-settings");
    await expect(panel.getByRole("heading", { name: "Operator notifications" })).toBeVisible();

    const webhook = panel.locator('[data-channel="webhook"]');
    const toggle = webhook.getByRole("switch", { name: "Webhook" });
    await expect(toggle).toBeEnabled();
    await webhook.getByLabel("Webhook URL").fill(`${SINK}/hooks/${hookName}`);
    if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
    await panel.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Notification settings saved")).toBeVisible();
    await expect(webhook.getByLabel("Webhook URL")).toHaveValue("");
    await expect(webhook.getByLabel("Webhook URL")).toHaveAttribute("placeholder", "Saved — leave blank to keep");

    await panel.getByRole("button", { name: "Send test notification" }).click();
    const results = page.getByTestId("notifier-test-results");
    await expect(results.locator('[data-result-channel="webhook"]')).toContainText("Sent");

    const hooks = await (await fetch(`${SINK}/hooks`)).json() as Array<{ name: string }>;
    expect(hooks.some((hook) => hook.name === hookName)).toBe(true);
  } finally {
    await page.request.put("/api/admin/notifier/config", {
      data: { webhook: { enabled: false, url: null } },
    });
  }
});
