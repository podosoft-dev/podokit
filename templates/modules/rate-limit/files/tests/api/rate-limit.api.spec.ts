import { expect, test } from "@playwright/test";

const base = process.env.E2E_BASE_URL ?? "http://localhost:5001";
const origin = { origin: base };

// rate-limit installs a global throttler guard (default RATE_LIMIT_MAX requests
// per RATE_LIMIT_TTL seconds, per client). This module ships a global guard, so
// it never joins the shared Outer smoke app (it would throttle every other
// spec); this spec ships with the module and runs against a dedicated app.
//
// Honor RATE_LIMIT_MAX when the test runner has it (a dedicated app sets a small
// value so the window is crossed in a handful of requests); otherwise fall back
// to the module default and allow a little headroom.
const limit = Number(process.env.RATE_LIMIT_MAX ?? 100);

test("rate limit: exceeding the window returns 429 @smoke", async ({ playwright }) => {
  const ctx = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  // /health is public — no session needed. If the first hit is a 5xx the
  // throttler's Redis backing isn't reachable; nothing to assert.
  const probe = await ctx.get("/api/health");
  test.skip(probe.status() >= 500, "throttler storage (redis) not reachable");

  let seen200 = probe.status() === 200;
  let got429 = false;
  for (let i = 0; i < limit + 5 && !got429; i++) {
    const r = await ctx.get("/api/health");
    if (r.status() === 200) seen200 = true;
    if (r.status() === 429) got429 = true;
  }
  // A fresh window serves the first requests (200) and rejects once the limit is
  // crossed (429).
  expect(seen200).toBe(true);
  expect(got429).toBe(true);
  await ctx.dispose();
});
