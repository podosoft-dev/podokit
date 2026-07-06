import { expect, test } from "@playwright/test";
import { ADMIN, USER } from "../helpers/accounts";

const base = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const origin = { origin: base };

async function signedIn(
  playwright: import("@playwright/test").PlaywrightWorkerArgs["playwright"],
  account: { email: string; password: string },
) {
  const ctx = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  await ctx.post("/api/auth/sign-in/email", { data: account });
  return ctx;
}

test("admin can create a user, set its password, and remove it", async ({ playwright }) => {
  const admin = await signedIn(playwright, ADMIN);
  const email = `api-crud-${Date.now()}@example.com`;

  const created = await admin.post("/api/auth/admin/create-user", {
    data: { email, password: "password123", name: "API CRUD", role: "user" },
  });
  expect(created.ok()).toBeTruthy();
  const id = (await created.json())?.user?.id as string;
  expect(id).toBeTruthy();

  const setPw = await admin.post("/api/auth/admin/set-user-password", {
    data: { userId: id, newPassword: "newpass1234" },
  });
  expect(setPw.ok()).toBeTruthy();

  // the new password works
  const fresh = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  const signin = await fresh.post("/api/auth/sign-in/email", { data: { email, password: "newpass1234" } });
  expect(signin.ok()).toBeTruthy();
  await fresh.dispose();

  const removed = await admin.post("/api/auth/admin/remove-user", { data: { userId: id } });
  expect(removed.ok()).toBeTruthy();
  await admin.dispose();
});

test("a normal user cannot create users (403)", async ({ playwright }) => {
  const user = await signedIn(playwright, USER);
  const res = await user.post("/api/auth/admin/create-user", {
    data: { email: `nope-${Date.now()}@example.com`, password: "password123", name: "Nope", role: "user" },
  });
  expect(res.status()).toBe(403);
  await user.dispose();
});

test("admin can list and revoke a user's sessions", async ({ playwright }) => {
  const admin = await signedIn(playwright, ADMIN);
  const email = `api-sess-${Date.now()}@example.com`;
  const created = await admin.post("/api/auth/admin/create-user", {
    data: { email, password: "password123", name: "API Sess", role: "user" },
  });
  const userId = (await created.json())?.user?.id as string;

  // the user signs in -> creates a session
  const theirs = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  expect((await theirs.post("/api/auth/sign-in/email", { data: { email, password: "password123" } })).ok()).toBeTruthy();
  await theirs.dispose();

  const listed = await admin.post("/api/auth/admin/list-user-sessions", { data: { userId } });
  expect(listed.ok()).toBeTruthy();
  expect(((await listed.json())?.sessions ?? []).length).toBeGreaterThan(0);

  const revoked = await admin.post("/api/auth/admin/revoke-user-sessions", { data: { userId } });
  expect(revoked.ok()).toBeTruthy();
  await admin.post("/api/auth/admin/remove-user", { data: { userId } });
  await admin.dispose();
});

test("revokeOtherSessions keeps the current session valid", async ({ playwright }) => {
  // Use a throwaway account so we don't revoke the shared USER's ui storageState.
  const admin = await signedIn(playwright, ADMIN);
  const email = `api-revoke-others-${Date.now()}@example.com`;
  await admin.post("/api/auth/admin/create-user", { data: { email, password: "password123", name: "RO", role: "user" } });
  await admin.dispose();

  const ctx = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  await ctx.post("/api/auth/sign-in/email", { data: { email, password: "password123" } });
  expect((await ctx.post("/api/auth/revoke-other-sessions")).ok()).toBeTruthy();
  const after = await ctx.get("/api/auth/get-session");
  expect((await after.json())?.user?.email).toBe(email); // still signed in
  await ctx.dispose();
});
