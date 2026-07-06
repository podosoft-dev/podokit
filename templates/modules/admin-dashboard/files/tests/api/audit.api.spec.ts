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

test("audit log records auth/admin actions", async ({ playwright }) => {
  const admin = await signedIn(playwright, ADMIN);
  const probe = await admin.get("/api/audit-logs");
  test.skip(probe.status() === 404, "audit-log module not installed");

  // an admin action that flows through better-auth (bypasses the interceptor)
  const email = `audit-${Date.now()}@example.com`;
  const created = await admin.post("/api/auth/admin/create-user", {
    data: { email, password: "password123", name: "Audit", role: "user" },
  });
  expect(created.ok()).toBeTruthy();
  const userId = (await created.json())?.user?.id as string;

  const res = await admin.get("/api/audit-logs");
  expect(res.ok()).toBeTruthy();
  const entries = (await res.json()) as Array<{ path: string; statusCode: number; userId: string | null }>;
  const entry = entries.find((e) => e.path === "/api/auth/admin/create-user");
  expect(entry, "create-user should be audited").toBeTruthy();
  expect(entry?.userId, "audit entry records the acting user").toBeTruthy();

  await admin.post("/api/auth/admin/remove-user", { data: { userId } });
  await admin.dispose();
});

test("the audit log is admin-only", async ({ playwright }) => {
  const admin = await signedIn(playwright, ADMIN);
  test.skip((await admin.get("/api/audit-logs")).status() === 404, "audit-log module not installed");
  await admin.dispose();

  const user = await signedIn(playwright, USER);
  expect((await user.get("/api/audit-logs")).status()).toBe(403);
  await user.dispose();
});
