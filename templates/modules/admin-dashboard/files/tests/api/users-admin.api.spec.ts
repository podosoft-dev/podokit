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
