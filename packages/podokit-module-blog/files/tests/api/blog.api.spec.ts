import {
  expect,
  test,
  type APIRequestContext,
  type Playwright,
} from "@playwright/test";
import { ADMIN, USER, type Account } from "../helpers/accounts";

const base = process.env.E2E_BASE_URL ?? "http://localhost:5001";
const PNG_PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function signedIn(
  playwright: Playwright,
  account: Account,
  create = false,
): Promise<APIRequestContext> {
  const context = await playwright.request.newContext({
    baseURL: base,
    extraHTTPHeaders: { origin: base },
  });
  if (create) {
    const signUp = await context.post("/api/auth/sign-up/email", {
      data: account,
    });
    expect(signUp.ok(), `sign up ${account.email}`).toBeTruthy();
  }
  const response = await context.post("/api/auth/sign-in/email", {
    data: { email: account.email, password: account.password },
  });
  expect(response.ok(), `sign in ${account.email}`).toBeTruthy();
  return context;
}

test("public posts and comments use paginated envelopes @smoke", async ({
  request,
}) => {
  const posts = await request.get("/api/blog?page=1&pageSize=10");
  expect(posts.ok()).toBeTruthy();
  const page = await posts.json();
  expect(page).toMatchObject({ page: 1, pageSize: 10 });
  expect(Array.isArray(page.items)).toBeTruthy();
  expect(typeof page.total).toBe("number");
  expect(typeof page.totalPages).toBe("number");
});

test("authenticated authors can upload stable public blog images", async ({
  playwright,
  request,
}) => {
  const context = await signedIn(playwright, USER);
  const uploaded = await context.post("/api/blog/images", {
    multipart: {
      file: { name: "pixel.png", mimeType: "image/png", buffer: PNG_PIXEL },
    },
  });
  expect(uploaded.status()).toBe(201);
  const image = (await uploaded.json()) as { id: string; url: string };
  expect(image.id).toMatch(/\.png$/);
  expect(image.url).toBe(`/api/blog/images/${image.id}`);

  const publicImage = await request.get(image.url);
  expect(publicImage.ok()).toBeTruthy();
  expect(publicImage.headers()["content-type"]).toContain("image/png");
  expect(publicImage.headers()["cache-control"]).toContain("immutable");
  expect((await publicImage.body()).equals(PNG_PIXEL)).toBeTruthy();

  const invalid = await context.post("/api/blog/images", {
    multipart: {
      file: {
        name: "not-an-image.png",
        mimeType: "image/png",
        buffer: Buffer.from("not an image"),
      },
    },
  });
  expect(invalid.status()).toBe(400);
  expect((await invalid.json()).error.code).toBe("BLOG_IMAGE_TYPE_INVALID");

  const anonymous = await request.post("/api/blog/images", {
    multipart: {
      file: { name: "pixel.png", mimeType: "image/png", buffer: PNG_PIXEL },
    },
  });
  expect(anonymous.status()).toBe(401);
  await context.dispose();
});

test("authenticated author can publish, edit, comment, and delete", async ({
  playwright,
}) => {
  const marker = Date.now();
  const context = await signedIn(
    playwright,
    {
      name: "Blog Author",
      email: `blog-author-${marker}@example.com`,
      password: USER.password,
    },
    true,
  );
  const created = await context.post("/api/blog", {
    data: {
      title: `User post ${marker}`,
      excerpt: "Published immediately",
      body: "# Safe",
      tags: ["e2e"],
    },
  });
  expect(created.ok()).toBeTruthy();
  const post = await created.json();
  expect(post.status).toBe("published");
  expect(post.authorId).toBeTruthy();

  const comment = await context.post(`/api/blog/${post.slug}/comments`, {
    data: { body: "A comment" },
  });
  expect(comment.ok()).toBeTruthy();
  const commentBody = await comment.json();
  const editedComment = await context.patch(
    `/api/blog/comments/${commentBody.id}`,
    {
      data: { body: "An edited comment" },
    },
  );
  expect(editedComment.ok()).toBeTruthy();

  const updated = await context.patch(`/api/blog/${post.id}`, {
    data: { excerpt: "Updated" },
  });
  expect(updated.ok()).toBeTruthy();
  expect((await updated.json()).excerpt).toBe("Updated");

  const removed = await context.delete(`/api/blog/${post.id}`);
  expect(removed.status()).toBe(204);
  expect((await context.get(`/api/blog/${post.slug}`)).status()).toBe(404);
  await context.dispose();
});

test("another user cannot modify an author's post while an admin can", async ({
  playwright,
}) => {
  const marker = Date.now();
  const user = await signedIn(
    playwright,
    {
      name: "Post Owner",
      email: `blog-owner-${marker}@example.com`,
      password: USER.password,
    },
    true,
  );
  const created = await user.post("/api/blog", {
    data: { title: `Owned ${marker}`, body: "body", tags: [] },
  });
  expect(created.ok()).toBeTruthy();
  const post = await created.json();

  const other = await signedIn(
    playwright,
    {
      name: "Other User",
      email: `blog-other-${marker}@example.com`,
      password: USER.password,
    },
    true,
  );
  const forbiddenUpdate = await other.patch(`/api/blog/${post.id}`, {
    data: { excerpt: "Not mine" },
  });
  expect(forbiddenUpdate.status()).toBe(403);
  expect((await forbiddenUpdate.json()).error.code).toBe("BLOG_POST_FORBIDDEN");
  expect((await other.delete(`/api/blog/${post.id}`)).status()).toBe(403);

  const admin = await signedIn(playwright, ADMIN);
  const updated = await admin.patch(`/api/admin/blog/${post.id}`, {
    data: { status: "draft" },
  });
  expect(updated.ok()).toBeTruthy();
  expect((await admin.get(`/api/blog/${post.slug}`)).status()).toBe(404);
  expect((await admin.delete(`/api/admin/blog/${post.id}`)).status()).toBe(204);

  await user.dispose();
  await other.dispose();
  await admin.dispose();
});

test("blog validation rejects oversized page requests and empty comments", async ({
  playwright,
  request,
}) => {
  expect((await request.get("/api/blog?pageSize=1000")).status()).toBe(400);
  const user = await signedIn(playwright, USER);
  const page = await user.get("/api/blog?pageSize=1");
  const first = (await page.json()).items[0] as { slug?: string } | undefined;
  if (first?.slug) {
    expect(
      (
        await user.post(`/api/blog/${first.slug}/comments`, {
          data: { body: "" },
        })
      ).status(),
    ).toBe(400);
  }
  await user.dispose();
});
