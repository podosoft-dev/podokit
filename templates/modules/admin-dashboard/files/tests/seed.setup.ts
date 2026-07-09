import { test as setup, expect } from "@playwright/test";
import { ADMIN, USER, adminState, userState, type Account } from "./helpers/accounts";

const base = process.env.E2E_BASE_URL ?? "http://localhost:5001";

// Seed a session via the API (reliable, no UI hydration races) and save its
// cookies as storageState for the browser `ui` project to reuse.
async function seedSession(
  playwright: import("@playwright/test").PlaywrightWorkerArgs["playwright"],
  account: Account,
  path: string,
): Promise<void> {
  const ctx = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: { origin: base } });
  await ctx.post("/api/auth/sign-up/email", { data: account }).catch(() => undefined); // idempotent
  const res = await ctx.post("/api/auth/sign-in/email", {
    data: { email: account.email, password: account.password },
  });
  expect(res.ok(), `sign-in ${account.email}`).toBeTruthy();
  await ctx.storageState({ path });
  await ctx.dispose();
}

setup("seed admin session", async ({ playwright }) => {
  await seedSession(playwright, ADMIN, adminState);
});

// Feature flags are DB-backed (seeded by the app_setting migration). phoneNumber
// ships off (needs an SMS provider); turn it on here so its specs run — this also
// exercises the admin settings API on every suite run.
setup("enable optional features", async ({ playwright }) => {
  const ctx = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: { origin: base } });
  await ctx.post("/api/auth/sign-in/email", { data: { email: ADMIN.email, password: ADMIN.password } });
  const res = await ctx.put("/api/account/settings", { data: { phoneNumber: true } });
  expect(res.ok(), "enable optional features via settings").toBeTruthy();
  await ctx.dispose();
});

setup("seed user session", async ({ playwright }) => {
  await seedSession(playwright, USER, userState);
});
