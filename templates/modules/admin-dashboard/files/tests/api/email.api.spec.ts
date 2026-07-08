import { expect, test } from "@playwright/test";
import { clearMailpit, mailpitReachable, waitForLink } from "../helpers/mailpit";

const base = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const origin = { origin: base };

// Follow an emailed auth link (which hits the API to validate) and read the
// token the API hands back on its redirect.
function tokenFromRedirect(location: string): string | null {
  return new URL(location, base).searchParams.get("token");
}

test("password reset delivers an email and updates the password @smoke", async ({ playwright }) => {
  test.skip(!(await mailpitReachable()), "Mailpit not available");
  const ctx = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  const email = `reset-${Date.now()}@example.com`;
  const signup = await ctx.post("/api/auth/sign-up/email", { data: { email, password: "password123", name: "Reset" } });
  expect(signup.ok()).toBeTruthy();
  // With verification on, sign-up returns no session and the new password still
  // can't sign in until confirmed — so only assert sign-in when it's off.
  const verificationOn = !(await signup.json())?.token;

  await clearMailpit();
  const requested = await ctx.post("/api/auth/request-password-reset", { data: { email, redirectTo: `${base}/reset-password` } });
  expect(requested.ok()).toBeTruthy();

  const link = await waitForLink(email);
  const redirected = await ctx.get(link, { maxRedirects: 0 });
  const token = tokenFromRedirect(redirected.headers()["location"] ?? "");
  expect(token, "the reset link resolves to a valid token").toBeTruthy();

  expect((await ctx.post("/api/auth/reset-password", { data: { newPassword: "newpass1234", token } })).ok()).toBeTruthy();
  if (!verificationOn) {
    expect((await ctx.post("/api/auth/sign-in/email", { data: { email, password: "newpass1234" } })).ok()).toBeTruthy();
    expect((await ctx.post("/api/auth/sign-in/email", { data: { email, password: "password123" } })).status()).toBe(401);
  }
  await ctx.dispose();
});

test("email verification blocks sign-in until the address is confirmed", async ({ playwright }) => {
  test.skip(!(await mailpitReachable()), "Mailpit not available");
  const ctx = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  const email = `verify-${Date.now()}@example.com`;
  await clearMailpit();
  const signup = await ctx.post("/api/auth/sign-up/email", { data: { email, password: "password123", name: "Verify", callbackURL: `${base}/admin` } });
  expect(signup.ok()).toBeTruthy();
  // When verification is off, sign-up returns a session — nothing to test here.
  test.skip(Boolean((await signup.json())?.token), "email verification not enabled");

  expect((await ctx.post("/api/auth/sign-in/email", { data: { email, password: "password123" } })).status()).toBe(403);
  const link = await waitForLink(email);
  await ctx.get(link, { maxRedirects: 0 });
  expect((await ctx.post("/api/auth/sign-in/email", { data: { email, password: "password123" } })).ok()).toBeTruthy();
  await ctx.dispose();
});
