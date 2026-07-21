import { expect, test } from "@playwright/test";

const base = process.env.E2E_BASE_URL ?? "http://localhost:5001";
const origin = { origin: base };

async function session(playwright: import("@playwright/test").PlaywrightWorkerArgs["playwright"]) {
  const ctx = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  const email = `files-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  await ctx.post("/api/auth/sign-up/email", { data: { email, password: "Podokit3e-Str0ng!pw", name: "F" } }).catch(() => undefined);
  return ctx;
}

test("file upload: multipart upload returns a key and url @smoke", async ({ playwright }) => {
  const ctx = await session(playwright);
  const res = await ctx.post("/api/files", {
    multipart: { file: { name: "hello.txt", mimeType: "text/plain", buffer: Buffer.from("hi there") } },
  });
  test.skip(res.status() >= 500, "object storage (MinIO/S3) not reachable");
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(typeof body.key).toBe("string");
  expect(String(body.url)).toContain("http");
  await ctx.dispose();
});

test("file upload: a request with no file is a 400", async ({ playwright }) => {
  const ctx = await session(playwright);
  const res = await ctx.post("/api/files", { multipart: { notfile: "x" } });
  expect(res.status()).toBe(400);
  await ctx.dispose();
});
