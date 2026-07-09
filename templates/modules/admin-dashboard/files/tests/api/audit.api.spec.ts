import { expect, test } from "@playwright/test";
import { ADMIN, USER } from "../helpers/accounts";

const base = process.env.E2E_BASE_URL ?? "http://localhost:5001";
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
    data: { email, password: "Podokit3e-Str0ng!pw", name: "Audit", role: "user" },
  });
  expect(created.ok()).toBeTruthy();
  const userId = (await created.json())?.user?.id as string;

  const res = await admin.get("/api/audit-logs");
  expect(res.ok()).toBeTruthy();
  const entries = (await res.json()) as Array<{ action: string; actorEmail: string | null; targetLabel: string | null }>;
  const entry = entries.find((e) => e.action === "user.create" && e.targetLabel === email);
  expect(entry, "user.create should be audited with the target").toBeTruthy();
  expect(entry?.actorEmail, "audit entry records the acting admin").toBe(ADMIN.email);

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

test("sending a verification email is audited", async ({ playwright }) => {
  const admin = await signedIn(playwright, ADMIN);
  test.skip((await admin.get("/api/audit-logs")).status() === 404, "audit-log module not installed");
  const email = `verif-audit-${Date.now()}@example.com`;
  await admin.post("/api/auth/admin/create-user", { data: { email, password: "Podokit3e-Str0ng!pw", name: "VA", role: "user" } });
  await admin.post("/api/auth/send-verification-email", { data: { email, callbackURL: `${base}/admin` } });
  const entries = (await (await admin.get("/api/audit-logs")).json()) as Array<{ action: string; targetLabel: string | null }>;
  expect(entries.some((e) => e.action === "auth.verification_sent"), "verification send should be audited").toBeTruthy();
  await admin.dispose();
});
