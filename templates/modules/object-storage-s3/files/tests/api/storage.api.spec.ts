import { expect, test } from "@playwright/test";

const base = process.env.E2E_BASE_URL ?? "http://localhost:5001";
const origin = { origin: base };

async function session(playwright: import("@playwright/test").PlaywrightWorkerArgs["playwright"]): Promise<import("@playwright/test").APIRequestContext> {
  const ctx = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  const email = `storage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  await ctx.post("/api/auth/sign-up/email", { data: { email, password: "Podokit3e-Str0ng!pw", name: "S" } }).catch(() => undefined);
  return ctx;
}

test("object storage: put, get, and presign @smoke", async ({ playwright }) => {
  const ctx = await session(playwright);
  const key = `obj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const put = await ctx.put(`/api/storage/${key}`, { data: { content: "hello world" } });
    test.skip(!process.env.S3_ENDPOINT && put.status() >= 500, "optional S3-compatible service not configured");
    expect(put.ok()).toBeTruthy();
    expect(await put.json()).toMatchObject({ key });

    const read = await ctx.get(`/api/storage/${key}`);
    expect(read.ok()).toBeTruthy();
    expect(await read.json()).toMatchObject({ key, content: "hello world" });

    const presigned = await ctx.get(`/api/storage/${key}/presigned`);
    expect(presigned.ok()).toBeTruthy();
    const pre = await presigned.json() as { url: string };
    expect(new URL(pre.url).pathname).toContain(key);
    // The URL is signed for the API's S3 endpoint. A containerized dev stack signs an
    // in-network host, so download it only when the runner was given that endpoint too.
    if (process.env.S3_ENDPOINT) {
      const download = await ctx.get(pre.url);
      expect(download.ok()).toBeTruthy();
      expect(await download.text()).toBe("hello world");
    }
  } finally {
    await ctx.dispose();
  }
});
