import { expect, test, type APIRequestContext, type APIResponse, type PlaywrightWorkerArgs } from "@playwright/test";

const base = process.env.E2E_BASE_URL ?? "http://localhost:5001";
const origin = { origin: base };

type Playwright = PlaywrightWorkerArgs["playwright"];

interface Session {
  ctx: APIRequestContext;
  /** Undefined when the app has no auth module. */
  userId: string | undefined;
}

async function session(playwright: Playwright): Promise<Session> {
  const ctx = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  const email = `files-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  await ctx.post("/api/auth/sign-up/email", { data: { email, password: "Podokit3e-Str0ng!pw", name: "F" } }).catch(() => undefined);
  const current = await ctx.get("/api/auth/get-session");
  const body = current.ok() ? await current.json() as { user?: { id?: string } } | null : null;
  return { ctx, userId: body?.user?.id };
}

function upload(ctx: APIRequestContext, text = "hi there"): Promise<APIResponse> {
  return ctx.post("/api/files", {
    multipart: { file: { name: "hello.txt", mimeType: "text/plain", buffer: Buffer.from(text) } },
  });
}

async function uploadedKey(ctx: APIRequestContext): Promise<string> {
  const res = await upload(ctx);
  test.skip(res.status() >= 500, "selected object storage is not reachable");
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json() as { key: string }).key;
}

// Keys contain slashes, so they travel URL-encoded as one path segment.
function presign(ctx: APIRequestContext, key: string): Promise<APIResponse> {
  return ctx.get(`/api/files/${encodeURIComponent(key)}/url`);
}

test("file upload: multipart upload returns a key and url @smoke", async ({ playwright }) => {
  const { ctx, userId } = await session(playwright);
  const res = await upload(ctx);
  const responseText = await res.text();
  test.skip(res.status() >= 500, "selected object storage is not reachable");
  expect(res.ok(), `upload returned ${res.status()}: ${responseText}`).toBeTruthy();
  const body = JSON.parse(responseText) as unknown;
  expect(typeof body).toBe("object");
  expect(body).not.toBeNull();
  if (typeof body !== "object" || body === null) throw new Error("upload response must be an object");
  const response = body as Record<string, unknown>;
  expect(typeof response.key).toBe("string");
  if (userId) expect(String(response.key)).toMatch(new RegExp(`^uploads/${userId}/[0-9a-f-]{36}-hello\\.txt$`));
  // S3 returns an absolute presigned URL; local storage returns a signed API path.
  expect(String(response.url)).toMatch(/^(https?:\/\/|\/files\/content\/)/);
  await ctx.dispose();
});

test("file upload: a request with no file is a 400", async ({ playwright }) => {
  const { ctx } = await session(playwright);
  const res = await ctx.post("/api/files", { multipart: { notfile: "x" } });
  expect(res.status()).toBe(400);
  await ctx.dispose();
});

test("file upload: the uploader can presign their own file", async ({ playwright }) => {
  const { ctx } = await session(playwright);
  try {
    const key = await uploadedKey(ctx);
    const res = await presign(ctx, key);
    expect(res.status(), await res.text()).toBe(200);
    const { url } = await res.json() as { url: string };
    expect(url).toContain(key.split("/").pop() ?? key);
  } finally {
    await ctx.dispose();
  }
});

test("file upload: users cannot presign another user's file", async ({ playwright }) => {
  const owner = await session(playwright);
  const other = await session(playwright);
  try {
    test.skip(!owner.userId || !other.userId, "requires the auth module");
    const key = await uploadedKey(owner.ctx);

    const forbidden = await presign(other.ctx, key);
    expect(forbidden.status()).toBe(403);
    expect(await forbidden.json()).toMatchObject({ error: { code: "FILE_FORBIDDEN" } });

    const foreign = await presign(other.ctx, "site/favicon");
    expect(foreign.status()).toBe(404);
    expect(await foreign.json()).toMatchObject({ error: { code: "FILE_NOT_FOUND" } });
  } finally {
    await owner.ctx.dispose();
    await other.ctx.dispose();
  }
});
