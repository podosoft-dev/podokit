import { expect, test } from "@playwright/test";
import { ready } from "../helpers/hydration";

// admin storageState (project default)

test("settings: add and remove a social login provider @smoke", async ({ page }) => {
  const dialog = page.getByRole("dialog");
  const addBtn = dialog.getByRole("button", { name: "Add provider" });
  const openConfigure = async (): Promise<void> => {
    await page.getByRole("tab", { name: "Authentication" }).click();
    await page.getByRole("button", { name: "Configure" }).click();
  };

  await ready(page, "/admin/settings");
  // The auth-config catalog can be momentarily unavailable right after another
  // spec toggles auth config (the auth instance rebuilds). Reload until the
  // catalog is loaded (Add provider becomes enabled).
  await expect(async () => {
    await page.reload();
    await openConfigure();
    await expect(addBtn).toBeEnabled({ timeout: 3000 });
  }).toPass({ timeout: 25000 });

  await addBtn.click();
  const provider = dialog.locator("#social-provider");
  await expect(provider).toBeVisible();
  const callback = await dialog.locator("code").textContent();
  const providerId = callback?.trim().split("/").pop() ?? ""; // first addable provider (not hard-coded)
  expect(providerId).not.toBe("");
  try {
    await dialog.locator("#social-id").fill("test-client-id");
    await dialog.locator("#social-secret").fill("test-secret");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    // Save returns to the list view, where the new provider row has an enable switch.
    await expect(dialog.getByRole("switch").first()).toBeVisible();
  } finally {
    if (providerId) {
      await page.request
        .put("/api/account/auth-config", { data: { social: { [providerId]: { delete: true } } } })
        .catch(() => undefined);
    }
  }
});

test("settings: open and save the SMTP dialog @smoke", async ({ page }) => {
  await ready(page, "/admin/settings");
  await page.getByRole("tab", { name: "Authentication" }).click();
  await page.getByRole("button", { name: "SMTP settings" }).click();
  const dialog = page.getByRole("dialog");
  try {
    // Point at the same Mailpit the env already uses, so saving can't re-route mail
    // for the other email specs.
    await dialog.locator("#smtp-host").fill("localhost");
    await dialog.locator("#smtp-port").fill("1125");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Setting updated").first()).toBeVisible();
  } finally {
    // Reset SMTP so the config store falls back to environment for later specs.
    await page.request
      .put("/api/account/auth-config", { data: { smtp: { enabled: false, host: "", port: 587, user: "", from: "", secure: false } } })
      .catch(() => undefined);
  }
});
