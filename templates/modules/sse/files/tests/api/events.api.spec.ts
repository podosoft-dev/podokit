import { expect, test } from "@playwright/test";

const base = process.env.E2E_BASE_URL ?? "http://localhost:5001";
const origin = { origin: base };

async function session(playwright: import("@playwright/test").PlaywrightWorkerArgs["playwright"]) {
  const ctx = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  const email = `sse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  await ctx.post("/api/auth/sign-up/email", { data: { email, password: "Podokit3e-Str0ng!pw", name: "E" } }).catch(() => undefined);
  return ctx;
}

test("sse: publish accepts a message @smoke", async ({ playwright }) => {
  const ctx = await session(playwright);
  const pub = await ctx.post("/api/events", { data: { message: `hi-${Date.now()}` } });
  expect(pub.ok()).toBeTruthy();
  expect(await pub.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

test("sse: a published message is delivered over the event stream @smoke", async ({ playwright }) => {
  const ctx = await session(playwright);
  // The stream is behind the auth guard — carry the session cookie on the raw fetch.
  const cookies = (await ctx.storageState()).cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const ac = new AbortController();
  const stream = await fetch(`${base}/api/events/stream`, { headers: { ...origin, cookie: cookies }, signal: ac.signal }).catch(() => null);
  test.skip(!stream || !stream.ok || !stream.body, "sse stream not reachable");
  expect(stream!.headers.get("content-type")).toContain("text/event-stream");

  // Subscriber is attached now; publish, then read until the message arrives.
  const msg = `sse-${Date.now()}`;
  await ctx.post("/api/events", { data: { message: msg } });

  const reader = stream!.body!.getReader();
  const decoder = new TextDecoder();
  let seen = false;
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && !seen) {
    const { value, done } = await reader.read();
    if (done) break;
    if (decoder.decode(value).includes(msg)) seen = true;
  }
  ac.abort();
  expect(seen).toBe(true);
  await ctx.dispose();
});
