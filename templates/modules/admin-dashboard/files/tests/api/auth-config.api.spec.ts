import { expect, test } from "@playwright/test";
import { ADMIN } from "../helpers/accounts";

const base = process.env.E2E_BASE_URL ?? "http://localhost:5001";
const origin = { origin: base };

// Fresh admin context (not the shared storageState) so these never rotate the
// seeded admin session.
async function adminCtx(playwright: import("@playwright/test").PlaywrightWorkerArgs["playwright"]) {
  const ctx = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  await ctx.post("/api/auth/sign-in/email", { data: { email: ADMIN.email, password: ADMIN.password } });
  return ctx;
}

test("admin can enable Google OAuth from the DB and it applies without a restart @smoke", async ({ playwright }) => {
  const admin = await adminCtx(playwright);
  await admin.put("/api/account/auth-config", { data: { social: { google: { enabled: false } } } }); // clean start
  const anon = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  const social = () => anon.post("/api/auth/sign-in/social", { data: { provider: "google", callbackURL: `${base}/admin` } });

  // Before: provider not configured.
  await expect.poll(async () => (await social()).status(), { timeout: 8000 }).toBe(404);

  // Paste credentials via the admin API.
  const put = await admin.put("/api/account/auth-config", {
    data: { social: { google: { enabled: true, clientId: "test-id.apps.googleusercontent.com", clientSecret: "GOCSPX-test-secret" } } },
  });
  expect(put.ok()).toBeTruthy();
  const view = await put.json();
  expect(view.social.google.hasSecret).toBe(true);
  expect(view.social.google.clientId).toBe("test-id.apps.googleusercontent.com");
  expect("clientSecret" in view.social.google).toBe(false); // secret is never returned

  // Applied live (no restart): social sign-in now redirects to Google.
  await expect
    .poll(async () => {
      const r = await social();
      return r.ok() ? (((await r.json())?.url as string) ?? "") : "";
    }, { timeout: 8000 })
    .toContain("accounts.google.com");
  const caps = await (await anon.get("/api/account/capabilities")).json();
  expect(caps.providers).toContain("google");

  await admin.put("/api/account/auth-config", { data: { social: { google: { enabled: false } } } }); // restore
  await anon.dispose();
  await admin.dispose();
});

test("admin can add and remove a social provider dynamically @smoke", async ({ playwright }) => {
  const admin = await adminCtx(playwright);
  // The catalog offers providers beyond the two legacy env-backed ones.
  const catalog = (await (await admin.get("/api/account/auth-config")).json()).catalog as Array<{ id: string }>;
  expect(catalog.map((c) => c.id)).toEqual(expect.arrayContaining(["google", "github", "apple"]));

  const anon = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  const github = () => anon.post("/api/auth/sign-in/social", { data: { provider: "github", callbackURL: `${base}/admin` } });

  // Add GitHub (a provider with no env fallback) → applies live, no restart.
  await admin.put("/api/account/auth-config", { data: { social: { github: { enabled: true, clientId: "gh-test-id", clientSecret: "gh-test-secret" } } } });
  await expect
    .poll(async () => { const r = await github(); return r.ok() ? (((await r.json())?.url as string) ?? "") : ""; }, { timeout: 8000 })
    .toContain("github.com");

  // Remove it → the row is deleted and the provider stops working (again live).
  await admin.put("/api/account/auth-config", { data: { social: { github: { delete: true } } } });
  expect("github" in (await (await admin.get("/api/account/auth-config")).json()).social).toBe(false);
  await expect.poll(async () => (await github()).status(), { timeout: 8000 }).toBe(404);

  await anon.dispose();
  await admin.dispose();
});

test("auth-config is admin-only and never leaks secrets @smoke", async ({ playwright }) => {
  const user = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  const email = `acfg-${Date.now()}@example.com`;
  await user.post("/api/auth/sign-up/email", { data: { email, password: "Podokit3e-Str0ng!pw", name: "U" } });
  expect((await user.get("/api/account/auth-config")).status()).toBe(403);
  expect((await user.put("/api/account/auth-config", { data: { server: { hibp: true } } })).status()).toBe(403);
  await user.dispose();
});
