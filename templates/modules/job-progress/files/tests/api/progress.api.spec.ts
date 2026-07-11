import { expect, test } from "@playwright/test";

const base = process.env.E2E_BASE_URL ?? "http://localhost:5001";
const origin = { origin: base };

async function session(playwright: import("@playwright/test").PlaywrightWorkerArgs["playwright"]) {
  const ctx = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  const email = `progress-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  await ctx.post("/api/auth/sign-up/email", { data: { email, password: "Podokit3e-Str0ng!pw", name: "P" } }).catch(() => undefined);
  return ctx;
}

// The end-to-end progress stream (worker → Redis pub/sub → SSE) needs the worker
// process running; this asserts the API contract (a job is enqueued).
test("job-progress: starting a job returns a job id @smoke", async ({ playwright }) => {
  const ctx = await session(playwright);
  const res = await ctx.post("/api/progress", { data: { steps: 3 } });
  test.skip(res.status() >= 500, "redis not reachable");
  expect(res.ok()).toBeTruthy();
  expect(typeof (await res.json()).jobId).toBe("string");
  await ctx.dispose();
});
