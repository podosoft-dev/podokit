import { expect, test } from "@playwright/test";
import { ADMIN, USER } from "../helpers/accounts";
import { clearSms, smsSinkReachable, waitForSmsOtp } from "../helpers/sms";
import { totpCode } from "../helpers/totp";

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

test("phone number: verify with the code delivered to the SMS sink @smoke", async ({ playwright }) => {
  const ctx = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  const caps = await (await ctx.get("/api/account/capabilities")).json();
  test.skip(!caps?.phoneNumber, "phone number not enabled");
  test.skip(!(await smsSinkReachable()), "SMS sink not reachable");
  await clearSms();
  const email = `phone-${Date.now()}@example.com`;
  await ctx.post("/api/auth/sign-up/email", { data: { email, password: "Podokit3e-Str0ng!pw", name: "Phone" } });
  // Unique number per run so the "phone already exists" guard never trips.
  const phone = `+1555${Date.now().toString().slice(-7)}`;

  const sent = await ctx.post("/api/auth/phone-number/send-otp", { data: { phoneNumber: phone } });
  expect(sent.ok()).toBeTruthy();
  const code = await waitForSmsOtp(phone); // read the real code back from the sink

  const verified = await ctx.post("/api/auth/phone-number/verify", {
    data: { phoneNumber: phone, code, updatePhoneNumber: true },
  });
  expect(verified.ok()).toBeTruthy();
  const session = await (await ctx.get("/api/auth/get-session")).json();
  expect(session?.user?.phoneNumber).toBe(phone);
  expect(session?.user?.phoneNumberVerified).toBe(true);
  await ctx.dispose();
});

test("two-factor: enable with a real TOTP code and require it at sign-in @smoke", async ({ playwright }) => {
  const ctx = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  const caps = await (await ctx.get("/api/account/capabilities")).json();
  test.skip(!caps?.twoFactor, "two-factor not enabled");
  const email = `tf-${Date.now()}@example.com`;
  const pw = "Podokit3e-Str0ng!pw";
  await ctx.post("/api/auth/sign-up/email", { data: { email, password: pw, name: "TF" } });

  // Enable 2FA and confirm it with a code computed from the returned otpauth URI.
  const enable = await (await ctx.post("/api/auth/two-factor/enable", { data: { password: pw } })).json();
  expect(typeof enable.totpURI).toBe("string");
  const verified = await ctx.post("/api/auth/two-factor/verify-totp", { data: { code: totpCode(enable.totpURI) } });
  expect(verified.ok()).toBeTruthy();

  // A fresh sign-in must now be challenged for the second factor (no full session).
  const ctx2 = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  const signin = await (await ctx2.post("/api/auth/sign-in/email", { data: { email, password: pw } })).json();
  expect(signin.twoFactorRedirect).toBe(true);
  const session = await (await ctx2.get("/api/auth/get-session")).json();
  expect(session?.user).toBeFalsy();
  await ctx.dispose();
  await ctx2.dispose();
});

test("multi-session holds several accounts and switches between them @smoke", async ({ playwright }) => {
  const ctx = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  const caps = await (await ctx.get("/api/account/capabilities")).json();
  test.skip(!caps?.multiSession, "multi-session not enabled");
  const pw = "Podokit3e-Str0ng!pw";
  const a = `ms-a-${Date.now()}@example.com`;
  const b = `ms-b-${Date.now()}@example.com`;
  await ctx.post("/api/auth/sign-up/email", { data: { email: a, password: pw, name: "A" } });
  await ctx.post("/api/auth/sign-up/email", { data: { email: b, password: pw, name: "B" } });
  type Device = { session: { token: string }; user: { email: string } };
  const devices = (await (await ctx.get("/api/auth/multi-session/list-device-sessions")).json()) as Device[];
  expect(devices.length).toBeGreaterThanOrEqual(2);
  // most recent sign-up is active; switch back to the first account
  const first = devices.find((d) => d.user?.email === a);
  expect(first?.session?.token).toBeTruthy();
  await ctx.post("/api/auth/multi-session/set-active", { data: { sessionToken: first!.session.token } });
  const session = await (await ctx.get("/api/auth/get-session")).json();
  expect(session?.user?.email).toBe(a);
  await ctx.dispose();
});

test("a user can sign in with a username @smoke", async ({ playwright }) => {
  const ctx = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  const caps = await (await ctx.get("/api/account/capabilities")).json();
  test.skip(!caps?.username, "username not enabled");
  const email = `uname-${Date.now()}@example.com`;
  const uname = `user${Date.now()}`;
  const pw = "Podokit3e-Str0ng!pw";
  await ctx.post("/api/auth/sign-up/email", { data: { email, password: pw, name: "Uname" } });
  expect((await ctx.post("/api/auth/update-user", { data: { username: uname } })).ok()).toBeTruthy();
  await ctx.dispose();
  const ctx2 = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  const signedIn = await ctx2.post("/api/auth/sign-in/username", { data: { username: uname, password: pw } });
  expect(signedIn.ok()).toBeTruthy();
  const session = await (await ctx2.get("/api/auth/get-session")).json();
  expect(session?.user?.username).toBe(uname);
  await ctx2.dispose();
});

test("a user can create, list and revoke a personal API key @smoke", async ({ playwright }) => {
  const ctx = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  const caps = await (await ctx.get("/api/account/capabilities")).json();
  test.skip(!caps?.apiKey, "api keys not enabled");
  const email = `apikey-${Date.now()}@example.com`;
  await ctx.post("/api/auth/sign-up/email", { data: { email, password: "Podokit3e-Str0ng!pw", name: "Key" } });

  const created = await ctx.post("/api/auth/api-key/create", { data: { name: "ci" } });
  expect(created.ok()).toBeTruthy();
  const key = (await created.json())?.key as string;
  expect(typeof key).toBe("string");
  expect(key.length).toBeGreaterThan(0);

  const body = (await (await ctx.get("/api/auth/api-key/list")).json()) as { apiKeys: Array<{ id: string; name: string | null }> };
  expect(body.apiKeys.some((k) => k.name === "ci")).toBeTruthy();

  const del = await ctx.post("/api/auth/api-key/delete", { data: { keyId: body.apiKeys[0].id } });
  expect(del.ok()).toBeTruthy();
  await ctx.dispose();
});

test("access control enforces custom role permissions @smoke", async ({ playwright }) => {
  const admin = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  await admin.post("/api/auth/sign-in/email", { data: { email: ADMIN.email, password: ADMIN.password } });
  const caps = await (await admin.get("/api/account/capabilities")).json();
  expect(caps.roles).toEqual(expect.arrayContaining(["admin", "moderator", "user"]));

  // A default user lacks the content:create permission.
  const email = `ac-${Date.now()}@example.com`;
  const pw = "Podokit3e-Str0ng!pw";
  const u = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  await u.post("/api/auth/sign-up/email", { data: { email, password: pw, name: "AC" } });
  const before = await (await u.post("/api/auth/admin/has-permission", { data: { permissions: { content: ["create"] } } })).json();
  expect(before.success).toBeFalsy();
  const me = await (await u.get("/api/auth/get-session")).json();
  await u.dispose();

  // Promote to moderator; a fresh session now passes the same check.
  const set = await admin.post("/api/auth/admin/set-role", { data: { userId: me.user.id, role: "moderator" } });
  expect(set.ok()).toBeTruthy();
  const u2 = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  await u2.post("/api/auth/sign-in/email", { data: { email, password: pw } });
  const after = await (await u2.post("/api/auth/admin/has-permission", { data: { permissions: { content: ["create"] } } })).json();
  expect(after.success).toBeTruthy();
  await u2.dispose();
  await admin.dispose();
});

test("a user can create, list and delete an organization @smoke", async ({ playwright }) => {
  const ctx = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  const caps = await (await ctx.get("/api/account/capabilities")).json();
  test.skip(!caps?.organization, "organizations not enabled");
  const email = `org-${Date.now()}@example.com`;
  await ctx.post("/api/auth/sign-up/email", { data: { email, password: "Podokit3e-Str0ng!pw", name: "Org" } });

  const slug = `acme-${Date.now()}`;
  const created = await ctx.post("/api/auth/organization/create", { data: { name: "Acme", slug } });
  expect(created.ok()).toBeTruthy();
  const orgId = (await created.json())?.id as string;
  expect(typeof orgId).toBe("string");

  const list = (await (await ctx.get("/api/auth/organization/list")).json()) as Array<{ id: string; slug: string }>;
  expect(list.some((o) => o.slug === slug)).toBeTruthy();

  const del = await ctx.post("/api/auth/organization/delete", { data: { organizationId: orgId } });
  expect(del.ok()).toBeTruthy();
  await ctx.dispose();
});

test("OIDC discovery is served only while the provider is enabled @smoke", async ({ playwright }) => {
  const admin = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  await admin.post("/api/auth/sign-in/email", { data: { email: ADMIN.email, password: ADMIN.password } });
  const caps = await (await admin.get("/api/account/capabilities")).json();
  test.skip(typeof caps?.oidcProvider !== "boolean", "oidc provider not present");

  const discoveryStatus = (): Promise<number> =>
    admin.get("/api/auth/.well-known/openid-configuration").then((r) => r.status());

  // Enable → the OpenID configuration is served with the standard endpoints.
  await admin.put("/api/account/settings", { data: { oidcProvider: true } });
  await expect.poll(discoveryStatus, { timeout: 8000 }).toBe(200);
  const cfg = await (await admin.get("/api/auth/.well-known/openid-configuration")).json();
  expect(typeof cfg.issuer).toBe("string");
  expect(typeof cfg.token_endpoint).toBe("string");

  // Disable → the discovery endpoint is gated off again (restore the default).
  await admin.put("/api/account/settings", { data: { oidcProvider: false } });
  await expect.poll(discoveryStatus, { timeout: 8000 }).toBe(404);
  await admin.dispose();
});

test("only admins can change settings @smoke", async ({ playwright }) => {
  const userCtx = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  await userCtx.post("/api/auth/sign-in/email", { data: { email: USER.email, password: USER.password } });
  const asUser = await userCtx.put("/api/account/settings", { data: { magicLink: false } });
  expect(asUser.status()).toBe(403);
  await userCtx.dispose();
});

test("disabling a feature blocks its endpoint server-side and re-enabling restores it @smoke", async ({ playwright }) => {
  // Uses a fresh admin context (not the shared storageState) so it never rotates
  // the seeded session. Toggles a flag and confirms the feature gate enforces it.
  const admin = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  await admin.post("/api/auth/sign-in/email", { data: { email: ADMIN.email, password: ADMIN.password } });
  const caps = await (await admin.get("/api/account/capabilities")).json();
  test.skip(!caps?.magicLink, "magic link not enabled");

  // A disabled feature's endpoint 404s; the gate reads the flag through a short cache.
  const status = (): Promise<number> =>
    admin.post("/api/auth/sign-in/magic-link", { data: { email: "probe@example.com" } }).then((r) => r.status());

  expect((await admin.put("/api/account/settings", { data: { magicLink: false } })).ok()).toBeTruthy();
  await expect.poll(status, { timeout: 8000 }).toBe(404);

  expect((await admin.put("/api/account/settings", { data: { magicLink: true } })).ok()).toBeTruthy();
  await expect.poll(status, { timeout: 8000 }).not.toBe(404);

  await admin.dispose();
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
