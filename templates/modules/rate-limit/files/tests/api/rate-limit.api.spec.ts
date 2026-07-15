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

test("rate limit: health probes stay available while ordinary routes return 429 @smoke", async ({
  playwright,
}) => {
  const ctx = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  for (const path of ["/api/health", "/api/health/ready"]) {
    for (let i = 0; i < limit + 5; i++) {
      const response = await ctx.get(path);
      expect(response.status(), `${path} request ${i + 1}`).toBe(200);
    }
  }

  // The redis module is added automatically and exposes a public demo cache
  // route, so it provides a stable ordinary endpoint for the global limit.
  const probe = await ctx.get("/api/cache/rate-limit-probe");
  test.skip(probe.status() >= 500, "throttler storage (redis) not reachable");

  let seen200 = probe.status() === 200;
  let got429 = false;
  for (let i = 0; i < limit + 5 && !got429; i++) {
    const response = await ctx.get("/api/cache/rate-limit-probe");
    if (response.status() === 200) seen200 = true;
    if (response.status() === 429) got429 = true;
  }
  // A fresh window serves the first requests (200) and rejects once the limit is
  // crossed (429).
  expect(seen200).toBe(true);
  expect(got429).toBe(true);
  await ctx.dispose();
});
