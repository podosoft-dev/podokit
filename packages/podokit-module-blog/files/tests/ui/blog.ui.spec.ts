import { expect, test } from "@playwright/test";
import { USER, adminState, userState } from "../helpers/accounts";
import { ready } from "../helpers/hydration";

const base = process.env.E2E_BASE_URL ?? "http://localhost:5001";
const PNG_PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("blog list renders pagination-ready content @smoke", async ({ page }) => {
  await ready(page, "/blog");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("main")).toBeVisible();
});

test.describe("signed-in blog author", () => {
  test.use({ storageState: userState });

  test("shows the signed-in account menu on blog pages", async ({ page }) => {
    await ready(page, "/blog");
    await page.getByTestId("account-menu").click();
    const label = page.getByRole("menu").locator('[data-slot="dropdown-menu-label"]');
    await expect(label.getByText(USER.name, { exact: true })).toBeVisible();
    await expect(label.getByText(USER.email, { exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /account|계정/i })).toBeVisible();
  });

  test("renders the same safe Markdown before and after publishing", async ({
    page,
  }) => {
    const marker = Date.now();
    const title = `Preview parity ${marker}`;
    const body = `# ${title}\n\n## Section\n\n> Quoted text\n\n1. First\n2. Second\n\n| State | Value |\n| --- | --- |\n| Ready | Yes |\n\n<script>alert(1)</script>`;
    await ready(page, "/blog/write");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const visibility = page.getByRole("switch", {
      name: /show post|게시글 표시/i,
    });
    await expect(visibility).not.toBeChecked();
    await page.getByLabel(/title|제목/i).fill(title);
    const bodyInput = page.getByLabel(/body|본문/i);
    await bodyInput.fill(body);
    await expect(
      page.getByRole("button", { name: /add image|이미지 추가/i }),
    ).toBeVisible();
    await page.locator("#blog-image").setInputFiles({
      name: "preview-pixel.png",
      mimeType: "image/png",
      buffer: PNG_PIXEL,
    });
    await expect(bodyInput).toHaveValue(
      /!\[preview-pixel\]\(\/api\/blog\/images\/.+\.png\)/,
    );
    await page.locator("#blog-cover-file").setInputFiles({
      name: "cover-pixel.png",
      mimeType: "image/png",
      buffer: PNG_PIXEL,
    });
    await expect(page.locator('img[src*="/api/blog/images/"]').first()).toBeVisible();
    await page.getByRole("tab", { name: /preview|미리보기/i }).click();
    const preview = page.locator("[data-blog-preview] [data-blog-prose]");
    await expect(
      preview.getByRole("heading", { name: "Section" }),
    ).toBeVisible();
    await expect(preview.locator("h1")).toHaveCount(0);
    await expect(preview.locator("blockquote")).toHaveCount(1);
    await expect(preview.locator("ol")).toHaveCount(1);
    await expect(preview.locator("table")).toHaveCount(1);
    await expect(preview.locator("img")).toHaveAttribute(
      "src",
      /\/api\/blog\/images\/.+\.png/,
    );
    await expect(preview.locator("script")).toHaveCount(0);
    const previewHtml = await preview.innerHTML();
    await visibility.click();
    await expect(visibility).toBeChecked();

    const save = page.getByRole("button", { name: /save|저장/i });
    let publishedSlug = "";
    await expect(async () => {
      const created = page.waitForResponse(
        (response) => new URL(response.url()).pathname === "/api/blog" && response.request().method() === "POST",
        { timeout: 3_000 },
      );
      await save.click();
      const response = await created;
      expect(response.ok()).toBeTruthy();
      const payload = (await response.json()) as { slug?: unknown };
      expect(typeof payload.slug).toBe("string");
      publishedSlug = String(payload.slug);
    }).toPass({ timeout: 10_000 });
    await expect(page).toHaveURL(new RegExp(`/blog/${publishedSlug}$`));
    const published = page.locator("article [data-blog-prose]");
    await expect(published).toBeVisible();
    expect(await published.innerHTML()).toBe(previewHtml);

    await page.getByRole("button", { name: /delete|삭제/i }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /delete|삭제/i })
      .click();
    await expect(page).toHaveURL(/\/blog$/);
  });

  test("keeps drafts private and preserves their first publication date", async ({
    page,
  }) => {
    const marker = Date.now();
    const title = `Draft visibility ${marker}`;
    await ready(page, "/blog/write");
    await page.getByLabel(/title|제목/i).fill(title);
    await page.getByLabel(/body|본문/i).fill("Draft lifecycle body");

    const created = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/blog" &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: /save|저장/i }).click();
    const createdResponse = await created;
    expect(createdResponse.ok()).toBeTruthy();
    const post = (await createdResponse.json()) as {
      id: string;
      slug: string;
      status: string;
      publishedAt: string | null;
    };
    expect(post.status).toBe("draft");
    expect(post.publishedAt).toBeNull();
    await expect(page).toHaveURL(new RegExp(`/blog/${post.slug}/edit$`));
    expect((await page.request.get(`/api/blog/${post.slug}`)).status()).toBe(404);

    await ready(page, "/blog/mine");
    const row = page.getByRole("row").filter({ hasText: title });
    await expect(row.getByText(/^(draft|초안)$/i)).toBeVisible();
    await row.getByRole("link", { name: /edit|수정/i }).click();

    const visibility = page.getByRole("switch", {
      name: /show post|게시글 표시/i,
    });
    await visibility.click();
    const firstPublish = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/blog/${post.id}` &&
        response.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: /save|저장/i }).click();
    const firstPublishedPost = (await (await firstPublish).json()) as {
      publishedAt: string;
    };
    await expect(page).toHaveURL(new RegExp(`/blog/${post.slug}$`));

    await page.getByRole("link", { name: /edit|수정/i }).first().click();
    await visibility.click();
    const hidden = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/blog/${post.id}` &&
        response.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: /save|저장/i }).click();
    expect((await (await hidden).json()).publishedAt).toBe(
      firstPublishedPost.publishedAt,
    );
    await expect(page).toHaveURL(new RegExp(`/blog/${post.slug}/edit$`));
    expect((await page.request.get(`/api/blog/${post.slug}`)).status()).toBe(404);

    await visibility.click();
    const republished = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/blog/${post.id}` &&
        response.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: /save|저장/i }).click();
    expect((await (await republished).json()).publishedAt).toBe(
      firstPublishedPost.publishedAt,
    );
    expect((await page.request.delete(`/api/blog/${post.id}`)).status()).toBe(204);
  });

  test("can create, edit, and delete a comment", async ({
    page,
    playwright,
  }) => {
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
    const post = (await created.json()) as { id: string; slug: string };

    await ready(page, `/blog/${post.slug}`);
    const initial = `Comment ${marker}`;
    const edited = `Edited comment ${marker}`;
    await page.locator("textarea").first().fill(initial);
    await page
      .getByRole("button", { name: /save|저장/i })
      .first()
      .click();
    await expect(page.getByText(initial, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /edit|수정/i }).click();
    await page.locator("textarea").nth(1).fill(edited);
    await page
      .getByRole("button", { name: /save|저장/i })
      .last()
      .click();
    await expect(page.getByText(edited, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /delete|삭제/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /delete|삭제/i }).click();
    await expect(page.getByText(edited, { exact: true })).toHaveCount(0);

    expect((await admin.delete(`/api/admin/blog/${post.id}`)).status()).toBe(
      204,
    );
    await admin.dispose();
  });
});
