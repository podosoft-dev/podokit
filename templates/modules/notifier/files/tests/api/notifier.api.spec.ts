import { expect, test, type APIRequestContext, type PlaywrightWorkerArgs } from "@playwright/test";
import { seededAdmin } from "../helpers/seeded-admin";

// Operator notifications: admin-only settings and the test endpoint. Delivery is
// checked end to end where the local catchers run: the webhook and a Pushover
// stand-in post to the dev sink (SMS_SINK_URL, /hooks/<name>; the API needs
// PUSHOVER_API_URL=<sink>/hooks/pushover), and email lands in Mailpit.
const base = process.env.E2E_BASE_URL ?? "http://localhost:5001";
const SINK = process.env.SMS_SINK_URL ?? "http://localhost:8095";
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";
const REQUIRE_MAIL = process.env.E2E_REQUIRE_MAIL === "true";
const origin = { origin: base };

type Playwright = PlaywrightWorkerArgs["playwright"];
type ChannelResult = { channel: string; ok: boolean; skipped: boolean; error?: string };
type Hook = { name: string; contentType: string; body: string };

function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function newContext(playwright: Playwright): Promise<APIRequestContext> {
  return playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
}

async function signInAdmin(ctx: APIRequestContext): Promise<boolean> {
  const admin = await seededAdmin();
  if (!admin) return false;
  return (await ctx.post("/api/auth/sign-in/email", { data: admin })).ok();
}

async function reachable(url: string): Promise<boolean> {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

async function hooksNamed(name: string): Promise<Hook[]> {
  const response = await fetch(`${SINK}/hooks`).catch(() => null);
  if (!response?.ok) return [];
  return ((await response.json()) as Hook[]).filter((hook) => hook.name === name);
}

async function mailTo(address: string, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`).catch(() => null);
    if (response?.ok && ((await response.json()) as { messages_count?: number }).messages_count) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function resetConfig(ctx: APIRequestContext): Promise<void> {
  await ctx.put("/api/admin/notifier/config", {
    data: {
      pushover: { enabled: false, token: null, userKey: null },
      email: { enabled: false, recipients: [] },
      webhook: { enabled: false, url: null },
    },
  });
}

test("notifier settings and test endpoint are administrator-only", async ({ playwright }) => {
  const anonymous = await newContext(playwright);
  try {
    expect((await anonymous.get("/api/admin/notifier/config")).status()).toBe(401);
    expect((await anonymous.post("/api/admin/notifier/test")).status()).toBe(401);
    expect((await anonymous.put("/api/admin/notifier/config", { data: {} })).status()).toBe(401);

    const email = `${unique("notifier-user")}@example.com`;
    const signUp = await anonymous.post("/api/auth/sign-up/email", {
      data: { email, password: "Podokit3e-Str0ng!pw", name: "Notifier user" },
    });
    const session = await anonymous.get("/api/auth/get-session");
    const signedIn = signUp.ok() && session.ok() && Boolean(((await session.json()) as { user?: unknown } | null)?.user);
    test.skip(!signedIn, "requires the auth module with open sign-up");
    expect((await anonymous.get("/api/admin/notifier/config")).status()).toBe(403);
    expect((await anonymous.post("/api/admin/notifier/test")).status()).toBe(403);
  } finally {
    await anonymous.dispose();
  }
});

test("saved channels deliver the test notification and secrets stay hidden", { tag: "@exclusive" }, async ({ playwright }) => {
  const admin = await newContext(playwright);
  try {
    test.skip(!(await signInAdmin(admin)), "requires the auth module and the seeded administrator");
    const token = unique("token");
    const userKey = unique("user");
    const hookName = unique("webhook");
    const recipient = `${unique("ops")}@example.com`;
    const webhookUrl = `${SINK}/hooks/${hookName}`;

    const invalid = await admin.put("/api/admin/notifier/config", { data: { webhook: { url: "ftp://example.com/hook" } } });
    expect(invalid.status()).toBe(400);
    expect(((await invalid.json()) as { error?: { code?: string } }).error?.code).toBe("NOTIFIER_CONFIG_INVALID");

    const saved = await admin.put("/api/admin/notifier/config", {
      data: {
        pushover: { enabled: true, token, userKey },
        email: { enabled: true, recipients: [recipient] },
        webhook: { enabled: true, url: webhookUrl },
      },
    });
    expect(saved.ok()).toBeTruthy();
    const view = await (await admin.get("/api/admin/notifier/config")).json() as Record<string, Record<string, unknown>>;
    expect(view.pushover).toEqual({ enabled: true, hasToken: true, hasUserKey: true });
    expect(view.email).toEqual({ enabled: true, recipients: [recipient] });
    expect(view.webhook).toEqual({ enabled: true, hasUrl: true });
    const text = JSON.stringify(view);
    for (const secret of [token, userKey, hookName]) expect(text).not.toContain(secret);

    const response = await admin.post("/api/admin/notifier/test");
    expect(response.ok()).toBeTruthy();
    const result = await response.json() as { ok: boolean; channels: ChannelResult[] };
    const byName = new Map(result.channels.map((channel) => [channel.channel, channel]));
    expect([...byName.keys()]).toEqual(expect.arrayContaining(["pushover", "email", "webhook"]));
    expect(byName.get("email")).toEqual({ channel: "email", ok: true, skipped: false });

    if (await reachable(`${SINK}/readyz`)) {
      expect(byName.get("webhook")).toEqual({ channel: "webhook", ok: true, skipped: false });
      const [hook] = await hooksNamed(hookName);
      expect(hook?.contentType).toContain("application/json");
      expect(JSON.parse(hook?.body ?? "{}")).toEqual({
        title: "Test notification",
        message: expect.stringContaining("Operator notifications are working"),
        url: null,
        priority: 0,
      });

      const pushover = (await hooksNamed("pushover"))
        .map((entry) => new URLSearchParams(entry.body))
        .find((form) => form.get("token") === token);
      if (pushover) {
        expect(byName.get("pushover")?.ok).toBe(true);
        expect(pushover.get("user")).toBe(userKey);
        expect(pushover.get("title")).toBe("Test notification");
        expect(pushover.get("priority")).toBe("0");
      } else {
        // Without PUSHOVER_API_URL the API calls the real service with fake keys.
        expect(byName.get("pushover")?.ok).toBe(false);
        test.info().annotations.push({ type: "skip-part", description: "PUSHOVER_API_URL does not point at the sink" });
      }
    } else {
      test.info().annotations.push({ type: "skip-part", description: `no sink answers at ${SINK}` });
    }

    const delivered = (await reachable(`${MAILPIT}/readyz`)) && (await mailTo(recipient));
    if (REQUIRE_MAIL) expect(delivered, `test email to ${recipient} reaches Mailpit`).toBe(true);
    else if (!delivered) test.info().annotations.push({ type: "skip-part", description: "no Mailpit delivery" });

    await resetConfig(admin);
    const off = await (await admin.post("/api/admin/notifier/test")).json() as { ok: boolean; channels: ChannelResult[] };
    expect(off.ok).toBe(false);
    for (const name of ["pushover", "email", "webhook"]) {
      expect(off.channels.find((channel) => channel.channel === name)?.skipped).toBe(true);
    }
  } finally {
    await resetConfig(admin).catch(() => {});
    await admin.dispose();
  }
});
