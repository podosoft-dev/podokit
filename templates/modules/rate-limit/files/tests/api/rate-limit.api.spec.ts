import { expect, test, type APIResponse } from "@playwright/test";

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
const limit = Number(process.env.RATE_LIMIT_MAX ?? 300);
const authLimit = Number(process.env.RATE_LIMIT_AUTH_MAX ?? 20);
const runtimeLimit = Number(process.env.RATE_LIMIT_RUNTIME_MAX ?? 1000);

async function session(
  playwright: import("@playwright/test").PlaywrightWorkerArgs["playwright"],
) {
  const ctx = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  const email = `rate-limit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const signup = await ctx.post("/api/auth/sign-up/email", {
    data: {
      email,
      password: "Podokit3e-Str0ng!pw",
      name: "Rate Limit",
    },
  });
  expect(signup.ok()).toBeTruthy();
  return ctx;
}

test("rate limit: health probes stay available while ordinary routes return 429 @smoke", async ({
  playwright,
}) => {
  const ctx = await session(playwright);
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
  let limitedResponse: APIResponse | undefined;
  for (let i = 0; i < limit + 5 && !limitedResponse; i++) {
    const response = await ctx.get("/api/cache/rate-limit-probe");
    if (response.status() === 200) seen200 = true;
    if (response.status() === 429) limitedResponse = response;
  }
  // A fresh window serves the first requests (200) and rejects once the limit is
  // crossed (429).
  expect(seen200).toBe(true);
  expect(limitedResponse?.status()).toBe(429);
  expect(limitedResponse?.headers()["retry-after"]).toBeTruthy();
  expect(await limitedResponse?.json()).toMatchObject({
    success: false,
    error: { code: "RATE_LIMIT_EXCEEDED", statusCode: 429 },
  });
  await ctx.dispose();
});

test("rate limit: each signed session has its own counter and forged sessions do not", async ({
  playwright,
}) => {
  const email = `rate-limit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = "Podokit3e-Str0ng!pw";
  const first = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  expect((await first.post("/api/auth/sign-up/email", { data: { email, password, name: "Rate Limit" } })).ok()).toBeTruthy();
  const probe = await first.get("/api/cache/rate-limit-probe");
  test.skip(probe.status() >= 500, "throttler storage (redis) not reachable");
  const remaining = (response: APIResponse): number => Number(response.headers()["ratelimit-remaining"]);
  const ceiling = Number(probe.headers()["ratelimit-limit"]);
  expect(remaining(probe)).toBe(ceiling - 1);

  // The signed bearer form of the same session shares its counter.
  const cookie = (await first.storageState()).cookies.find((c) => c.name.endsWith("session_token"));
  expect(cookie, "sign-up set a session cookie").toBeTruthy();
  const bearer = await playwright.request.newContext({
    baseURL: base,
    extraHTTPHeaders: { ...origin, authorization: `Bearer ${cookie?.value ?? ""}` },
  });
  expect(remaining(await bearer.get("/api/cache/rate-limit-probe"))).toBe(ceiling - 2);

  // Counters follow the session, not the user: signing in again starts a new one.
  const second = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  expect((await second.post("/api/auth/sign-in/email", { data: { email, password } })).ok()).toBeTruthy();
  expect(remaining(await second.get("/api/cache/rate-limit-probe"))).toBe(ceiling - 1);

  // A session cookie without a valid signature is counted with anonymous traffic
  // from the same client address instead of receiving a fresh counter. The cache
  // probe requires a session, so compare on a public route with the general limit.
  const token = decodeURIComponent(cookie?.value ?? "").split(".")[0] ?? "";
  const forged = await playwright.request.newContext({
    baseURL: base,
    extraHTTPHeaders: { ...origin, cookie: `${cookie?.name ?? ""}=${token}.${"A".repeat(43)}%3D` },
  });
  const anonymous = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  await expect(async () => {
    const before = await anonymous.get("/api/account/capabilities");
    const after = await forged.get("/api/account/capabilities");
    expect(before.status()).toBe(200);
    expect(remaining(after)).toBeLessThan(remaining(before));
  }).toPass({ timeout: 10_000 });

  for (const context of [first, bearer, second, forged, anonymous]) await context.dispose();
});

test("rate limit: session reads do not consume the strict authentication budget", async ({
  playwright,
}) => {
  const ctx = await session(playwright);
  for (let i = 0; i < authLimit + 5; i++) {
    const response = await ctx.get("/api/auth/get-session");
    expect(response.status(), `session request ${i + 1}`).toBe(200);
  }
  await ctx.dispose();
});

test("rate limit: each route is counted in its most specific registered budget", async ({
  playwright,
}) => {
  const ctx = await session(playwright);
  const probe = await ctx.get("/api/account/capabilities");
  test.skip(probe.status() >= 500, "throttler storage (redis) not reachable");
  const ceiling = (response: APIResponse): number => Number(response.headers()["ratelimit-limit"]);

  // Ordinary routes fall back to the general budget registered at "/".
  expect(ceiling(probe)).toBe(limit);
  // Longer GET prefixes inside "/api/auth" win over its authentication budget:
  // session reads use the runtime budget and administrator reads the general one.
  expect(ceiling(await ctx.get("/api/auth/get-session"))).toBe(runtimeLimit);
  expect(ceiling(await ctx.get("/api/auth/admin/list-users"))).toBe(limit);
  // Other "/api/auth" requests carry the strict authentication budget.
  expect(ceiling(await ctx.post("/api/auth/sign-out", { data: {} }))).toBe(authLimit);
  await ctx.dispose();
});
