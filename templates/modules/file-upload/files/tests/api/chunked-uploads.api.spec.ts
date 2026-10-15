import { createHash, randomBytes } from "node:crypto";
import { expect, test, type APIRequestContext, type APIResponse, type PlaywrightWorkerArgs } from "@playwright/test";

const base = process.env.E2E_BASE_URL ?? "http://localhost:5001";
// Parts are larger than the web server's BODY_SIZE_LIMIT, so they go to the API
// the way the gateway's direct apiPaths entry sends them: E2E_API_URL when the
// harness provides it, otherwise /api on a gateway that routes the path.
const apiBase = process.env.E2E_API_URL ?? `${base}/api`;
const uploads = `${apiBase}/files/uploads`;

type Playwright = PlaywrightWorkerArgs["playwright"];

interface Created {
  id: string;
  partSize: number;
  partCount: number;
  expiresAt: string;
}

async function session(playwright: Playwright): Promise<{ ctx: APIRequestContext; userId: string | undefined }> {
  const ctx = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: { origin: base } });
  const email = `chunks-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  await ctx.post("/api/auth/sign-up/email", { data: { email, password: "Podokit3e-Str0ng!pw", name: "C" } }).catch(() => undefined);
  const current = await ctx.get("/api/auth/get-session");
  const body = current.ok() ? await current.json() as { user?: { id?: string } } | null : null;
  return { ctx, userId: body?.user?.id };
}

async function create(ctx: APIRequestContext, size: number, filename = "big.bin"): Promise<Created> {
  const res = await ctx.post(uploads, { data: { filename, size, contentType: "application/octet-stream" } });
  test.skip(res.status() >= 500, "selected object storage is not reachable");
  expect(res.status(), await res.text()).toBe(201);
  return await res.json() as Created;
}

function putPart(ctx: APIRequestContext, id: string, partNumber: number, body: Buffer): Promise<APIResponse> {
  return ctx.put(`${uploads}/${id}/parts/${partNumber}`, {
    data: body,
    headers: { "content-type": "application/octet-stream" },
  });
}

function part(file: Buffer, upload: Created, partNumber: number): Buffer {
  return file.subarray((partNumber - 1) * upload.partSize, partNumber * upload.partSize);
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

test("chunked upload: parts, a retried part, resume status, and complete store the file", async ({ playwright }) => {
  const { ctx, userId } = await session(playwright);
  try {
    const probe = await create(ctx, 1);
    expect((await ctx.delete(`${uploads}/${probe.id}`)).status()).toBe(204);
    const file = randomBytes(probe.partSize + 1024 * 1024 + 123);
    const upload = await create(ctx, file.byteLength);
    expect(upload.partCount).toBe(2);

    expect((await putPart(ctx, upload.id, 2, part(file, upload, 2))).status()).toBe(200);
    const first = await putPart(ctx, upload.id, 1, part(file, upload, 1));
    expect(first.status(), await first.text()).toBe(200);
    expect(await first.json()).toEqual({ partNumber: 1, size: upload.partSize });
    // Sending a part again (a client retry) replaces it.
    expect((await putPart(ctx, upload.id, 1, part(file, upload, 1))).status()).toBe(200);

    const status = await ctx.get(`${uploads}/${upload.id}`);
    expect(status.status()).toBe(200);
    expect(await status.json()).toMatchObject({ status: "open", size: file.byteLength, receivedParts: [1, 2] });

    const done = await ctx.post(`${uploads}/${upload.id}/complete`, { data: {} });
    expect(done.status(), await done.text()).toBe(200);
    const result = await done.json() as { key: string; size: number; url: string; status: string };
    expect(result.status).toBe("completed");
    expect(result.size).toBe(file.byteLength);
    if (userId) expect(result.key).toMatch(new RegExp(`^uploads/${userId}/${upload.id}-big\\.bin$`));
    // Completing again returns the same result.
    expect(await (await ctx.post(`${uploads}/${upload.id}/complete`, { data: {} })).json()).toMatchObject({ key: result.key });

    // S3 returns an absolute presigned URL; local storage a signed API path.
    const download = await ctx.get(result.url.startsWith("/") ? `${apiBase}${result.url}` : result.url);
    expect(download.status()).toBe(200);
    const stored = await download.body();
    expect(stored.byteLength).toBe(file.byteLength);
    expect(sha256(stored)).toBe(sha256(file));
  } finally {
    await ctx.dispose();
  }
});

test("chunked upload: other users see 404 for every upload route", async ({ playwright }) => {
  const owner = await session(playwright);
  const other = await session(playwright);
  try {
    test.skip(!owner.userId || !other.userId, "requires the auth module");
    const upload = await create(owner.ctx, 10);
    for (const res of [
      await other.ctx.get(`${uploads}/${upload.id}`),
      await putPart(other.ctx, upload.id, 1, Buffer.alloc(10)),
      await other.ctx.post(`${uploads}/${upload.id}/complete`, { data: {} }),
      await other.ctx.delete(`${uploads}/${upload.id}`),
    ]) {
      expect(res.status()).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: "UPLOAD_NOT_FOUND" } });
    }
    expect((await owner.ctx.get(`${uploads}/${upload.id}`)).status()).toBe(200);
  } finally {
    await owner.ctx.dispose();
    await other.ctx.dispose();
  }
});

test("chunked upload: DELETE cancels the upload and later parts are refused", async ({ playwright }) => {
  const { ctx } = await session(playwright);
  try {
    const upload = await create(ctx, 20);
    expect((await ctx.delete(`${uploads}/${upload.id}`)).status()).toBe(204);
    expect(await (await ctx.get(`${uploads}/${upload.id}`)).json()).toMatchObject({ status: "aborted" });
    const late = await putPart(ctx, upload.id, 1, Buffer.alloc(20));
    expect(late.status()).toBe(410);
    expect(await late.json()).toMatchObject({ error: { code: "UPLOAD_ABORTED" } });
    expect((await ctx.delete(`${uploads}/${upload.id}`)).status()).toBe(204);
  } finally {
    await ctx.dispose();
  }
});

test("chunked upload: a part of the wrong size or content type is refused", async ({ playwright }) => {
  const { ctx } = await session(playwright);
  try {
    const upload = await create(ctx, 20);
    const short = await putPart(ctx, upload.id, 1, Buffer.alloc(19));
    expect(short.status()).toBe(400);
    expect(await short.json()).toMatchObject({ error: { code: "UPLOAD_PART_SIZE_MISMATCH" } });

    const text = await ctx.put(`${uploads}/${upload.id}/parts/1`, { data: "x".repeat(20), headers: { "content-type": "text/plain" } });
    expect(text.status()).toBe(415);
    expect(await text.json()).toMatchObject({ error: { code: "UNSUPPORTED_MEDIA_TYPE" } });

    const incomplete = await ctx.post(`${uploads}/${upload.id}/complete`, { data: {} });
    expect(incomplete.status()).toBe(409);
    expect(await incomplete.json()).toMatchObject({ error: { code: "UPLOAD_INCOMPLETE" } });
    expect((await ctx.delete(`${uploads}/${upload.id}`)).status()).toBe(204);
  } finally {
    await ctx.dispose();
  }
});
