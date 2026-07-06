import type { Page } from "@playwright/test";

// SvelteKit dev hydration can attach event handlers slightly after load;
// wait for the page to settle before driving client-only interactions.
export async function ready(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState("load");
  await page.waitForTimeout(400);
}
