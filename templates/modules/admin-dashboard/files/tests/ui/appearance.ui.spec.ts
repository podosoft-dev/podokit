import { expect, test } from "@playwright/test";
import { ready } from "../helpers/hydration";

// admin storageState (project default). The Appearance controls live in their
// own "Appearance" settings tab.
async function openAppearance(page: import("@playwright/test").Page): Promise<void> {
  await ready(page, "/admin/settings");
  await page.getByRole("tab", { name: "Appearance" }).click();
}

test("appearance: has its own tab with theme controls @smoke", async ({ page }) => {
  await ready(page, "/admin/settings");
  await expect(page.getByRole("tab", { name: "Appearance" })).toBeVisible();
  await page.getByRole("tab", { name: "Appearance" }).click();
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
  await expect(page.getByText("Theme preset", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Theme preset")).toBeVisible();
  await expect(page.getByText("Accent color", { exact: true })).toBeVisible();
  await expect(page.getByText("Preview", { exact: true })).toBeVisible();
});

test("appearance: preview light/dark toggle switches modes", async ({ page }) => {
  await openAppearance(page);
  await expect(page.getByRole("button", { name: "Light" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dark" })).toBeVisible();
  await page.getByRole("button", { name: "Dark" }).click();
});

test("appearance: advanced reveals per-token pickers", async ({ page }) => {
  await openAppearance(page);
  await page.getByText("Advanced — per-token colors").click();
  await expect(page.getByRole("button", { name: "Reset to preset" })).toBeVisible();
});

test("appearance: pick a preset, save, apply live, then restore @smoke", async ({ page }) => {
  await openAppearance(page);
  await page.getByLabel("Theme preset").click();
  await page.getByRole("option", { name: "Slate" }).click();
  await page.getByRole("button", { name: "Save appearance" }).click();
  await expect(page.getByText("General settings saved.").first()).toBeVisible();
  // Applied globally via the scoped override stylesheet.
  await expect.poll(async () => page.locator("#podokit-theme").count()).toBeGreaterThan(0);

  // "Restore defaults" reverts everything in one click and persists.
  await page.getByRole("button", { name: "Restore defaults" }).click();
  await expect(page.getByText("General settings saved.").first()).toBeVisible();
  await expect.poll(async () => page.locator("#podokit-theme").count()).toBe(0);
});
