import { expect, test, type Page } from "@playwright/test";
import { anonState } from "../helpers/accounts";
import { ready } from "../helpers/hydration";

// Verifies that the General settings actually take effect (not just persist).
// The admin storageState (project default) drives the toggles; a fresh anonymous
// context checks the public-facing result. Serial workers (workers:1) make the
// toggle-then-restore pattern safe for the rest of the suite; restores run in a
// `finally` so a mid-test failure still leaves the shared site settings clean.

async function saveGeneral(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("General settings saved.")).toBeVisible();
}

test("general: footer text and links render on public pages @smoke", async ({ page }) => {
  await ready(page, "/admin/settings");
  const footer = page.getByLabel("Footer text");
  const support = page.getByLabel("Support email");
  const origFooter = await footer.inputValue();
  const origSupport = await support.inputValue();
  await footer.fill("© 2026 PodoKit Test");
  await support.fill("help@example.com");
  await saveGeneral(page);
  try {
    await page.goto("/");
    await expect(page.getByText("© 2026 PodoKit Test")).toBeVisible();
    await expect(page.getByRole("link", { name: "Support" })).toHaveAttribute("href", "mailto:help@example.com");
  } finally {
    await ready(page, "/admin/settings");
    await page.getByLabel("Footer text").fill(origFooter);
    await page.getByLabel("Support email").fill(origSupport);
    await saveGeneral(page);
  }
});

test("general: maintenance mode holds non-admins on the maintenance page @smoke", async ({ page, browser }) => {
  await ready(page, "/admin/settings");
  const origin = new URL(page.url()).origin;
  await page.getByRole("switch", { name: "Maintenance mode" }).click();
  await saveGeneral(page);
  try {
    const ctx = await browser.newContext({ storageState: anonState });
    const anon = await ctx.newPage();
    await anon.goto(`${origin}/`);
    await expect(anon).toHaveURL(/\/maintenance$/);
    await expect(anon.getByRole("heading", { name: "Under maintenance" })).toBeVisible();
    await ctx.close();
    // the admin is not held back
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  } finally {
    await ready(page, "/admin/settings");
    const t = page.getByRole("switch", { name: "Maintenance mode" });
    if (await t.isChecked()) {
      await t.click();
      await saveGeneral(page);
    }
  }
});

test("general: closing sign-up redirects /signup and hides the link @smoke", async ({ page, browser }) => {
  await ready(page, "/admin/settings");
  const origin = new URL(page.url()).origin;
  await page.getByRole("switch", { name: "Allow public sign-up" }).click();
  await saveGeneral(page);
  try {
    const ctx = await browser.newContext({ storageState: anonState });
    const anon = await ctx.newPage();
    await anon.goto(`${origin}/signup`);
    await expect(anon).toHaveURL(/\/login/);
    await expect(anon.getByRole("link", { name: "Sign up" })).toHaveCount(0);
    await ctx.close();
  } finally {
    await ready(page, "/admin/settings");
    const t = page.getByRole("switch", { name: "Allow public sign-up" });
    if (!(await t.isChecked())) {
      await t.click();
      await saveGeneral(page);
    }
  }
});
