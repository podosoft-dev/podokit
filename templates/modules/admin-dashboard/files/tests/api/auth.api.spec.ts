import { expect, test } from "@playwright/test";
import { ADMIN, USER } from "../helpers/accounts";

const base = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const origin = { origin: base };

// Accounts are created by the `setup` project (this `api` project depends on it).
test("account/me is 401 when unauthenticated @smoke", async ({ request }) => {
  const res = await request.get("/api/account/me", { headers: origin });
  expect(res.status()).toBe(401);
});

test("rejects a breached password on sign-up @smoke", async ({ playwright }) => {
  const ctx = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  await ctx.post("/api/auth/sign-in/email", { data: { email: ADMIN.email, password: ADMIN.password } });
  const caps = await (await ctx.get("/api/account/capabilities")).json();
  test.skip(!caps?.passwordBreachCheck, "breach check not enabled");
  // "password" is one of the most-breached passwords; Have I Been Pwned rejects it.
  const res = await ctx.post("/api/auth/sign-up/email", {
    data: { name: "Pwned", email: `pwned-${Date.now()}@example.com`, password: "password" },
  });
  expect(res.ok()).toBeFalsy();
  await ctx.dispose();
});

test("only admins can change settings @smoke", async ({ playwright }) => {
  const userCtx = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  await userCtx.post("/api/auth/sign-in/email", { data: { email: USER.email, password: USER.password } });
  const asUser = await userCtx.put("/api/account/settings", { data: { magicLink: false } });
  expect(asUser.status()).toBe(403);
  await userCtx.dispose();
});

test("sign-in with a wrong password is rejected", async ({ request }) => {
  const res = await request.post("/api/auth/sign-in/email", {
    headers: origin,
    data: { email: ADMIN.email, password: "definitely-wrong" },
  });
  expect(res.ok()).toBeFalsy();
});

test("ADMIN_EMAILS account has the admin role @smoke", async ({ playwright }) => {
  const ctx = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  await ctx.post("/api/auth/sign-in/email", { data: { email: ADMIN.email, password: ADMIN.password } });
  const session = await ctx.get("/api/auth/get-session");
  const body = await session.json();
  expect(body?.user?.email).toBe(ADMIN.email);
  expect(body?.user?.role).toBe("admin");
  await ctx.dispose();
});

test("admin can list users, a normal user cannot (403)", async ({ playwright }) => {
  const adminCtx = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  await adminCtx.post("/api/auth/sign-in/email", { data: { email: ADMIN.email, password: ADMIN.password } });
  const asAdmin = await adminCtx.get("/api/auth/admin/list-users?limit=5");
  expect(asAdmin.ok()).toBeTruthy();
  await adminCtx.dispose();

  const userCtx = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  await userCtx.post("/api/auth/sign-in/email", { data: { email: USER.email, password: USER.password } });
  const asUser = await userCtx.get("/api/auth/admin/list-users?limit=5");
  expect(asUser.status()).toBe(403);
  await userCtx.dispose();
});
