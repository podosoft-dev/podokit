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

  test("renders the same safe Markdown before and after publishing", async ({ page }) => {
    const marker = Date.now();
    const title = `Preview parity ${marker}`;
    const body = `# ${title}\n\n## Section\n\n> Quoted text\n\n1. First\n2. Second\n\n| State | Value |\n| --- | --- |\n| Ready | Yes |\n\n<script>alert(1)</script>`;
    await ready(page, "/blog/write");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.getByLabel(/title|제목/i).fill(title);
    await page.getByLabel(/body|본문/i).fill(body);
    await page.getByRole("tab", { name: /preview|미리보기/i }).click();
    const preview = page.locator("[data-blog-preview] [data-blog-prose]");
    await expect(preview.getByRole("heading", { name: "Section" })).toBeVisible();
    await expect(preview.locator("h1")).toHaveCount(0);
    await expect(preview.locator("blockquote")).toHaveCount(1);
    await expect(preview.locator("ol")).toHaveCount(1);
    await expect(preview.locator("table")).toHaveCount(1);
    await expect(preview.locator("script")).toHaveCount(0);
    const previewHtml = await preview.innerHTML();

    await page.getByRole("button", { name: /save|저장/i }).click();
    await expect(page).toHaveURL(/\/blog\//);
    const published = page.locator("article [data-blog-prose]");
    await expect(published).toBeVisible();
    expect(await published.innerHTML()).toBe(previewHtml);

    await page.getByRole("button", { name: /delete|삭제/i }).click();
    await page.getByRole("dialog").getByRole("button", { name: /delete|삭제/i }).click();
    await expect(page).toHaveURL(/\/blog$/);
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
