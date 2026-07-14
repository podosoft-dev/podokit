import { expect, test } from "@playwright/test";
import { adminState, userState } from "../helpers/accounts";
import { ready } from "../helpers/hydration";

const base = process.env.E2E_BASE_URL ?? "http://localhost:5001";

test("blog list renders pagination-ready content @smoke", async ({ page }) => {
  await ready(page, "/blog");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("main")).toBeVisible();
});

test.describe("signed-in blog author", () => {
  test.use({ storageState: userState });

  test("can open the Markdown editor and preview safely", async ({ page }) => {
    await ready(page, "/blog/write");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.getByLabel(/title|제목/i).fill("Playwright post");
    await page.getByLabel(/body|본문/i).fill("# Preview\n\n<script>alert(1)</script>");
    await page.getByRole("tab", { name: /preview|미리보기/i }).click();
    await expect(page.getByRole("heading", { name: "Preview" })).toBeVisible();
    await expect(page.locator("article script")).toHaveCount(0);
  });

  test("can create, edit, and delete a comment", async ({ page, playwright }) => {
    const marker = Date.now();
    const admin = await playwright.request.newContext({
      baseURL: base,
      storageState: adminState,
      extraHTTPHeaders: { origin: base },
    });
    const created = await admin.post("/api/admin/blog", {
      data: {
        title: `Comment UI ${marker}`,
        body: "Comment interaction test",
        status: "published",
        tags: ["e2e"],
      },
    });
    expect(created.ok()).toBeTruthy();
    const post = await created.json() as { id: string; slug: string };

    await ready(page, `/blog/${post.slug}`);
    const initial = `Comment ${marker}`;
    const edited = `Edited comment ${marker}`;
    await page.locator("textarea").first().fill(initial);
    await page.getByRole("button", { name: /save|저장/i }).first().click();
    await expect(page.getByText(initial, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /edit|수정/i }).click();
    await page.locator("textarea").nth(1).fill(edited);
    await page.getByRole("button", { name: /save|저장/i }).last().click();
    await expect(page.getByText(edited, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /delete|삭제/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /delete|삭제/i }).click();
    await expect(page.getByText(edited, { exact: true })).toHaveCount(0);

    expect((await admin.delete(`/api/admin/blog/${post.id}`)).status()).toBe(204);
    await admin.dispose();
  });
});
