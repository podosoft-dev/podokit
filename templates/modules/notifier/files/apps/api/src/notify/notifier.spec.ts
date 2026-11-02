import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { Transporter } from "nodemailer";
import { setMailTransport } from "../mail/mailer";
import { envNotifierConfig, type NotifierConfig } from "./notifier-config";
import {
  NOTIFY_LIMITS,
  clampPriority,
  emailChannel,
  normalizeNotification,
  notifyOperators,
  pushoverChannel,
  setNotifierConfigSource,
  setNotifierLogger,
  setNotifyChannel,
  webhookChannel,
} from "./notifier";

type Captured = { path: string; contentType: string; body: string };
const captured: Captured[] = [];
let failPushover = false;
let server: ReturnType<typeof Bun.serve>;
let base = "";
const warnings: Array<{ meta: Record<string, unknown>; message: string }> = [];

function config(overrides: Partial<NotifierConfig> = {}): NotifierConfig {
  return {
    pushover: { enabled: true, token: "app-token", userKey: "user-key" },
    email: { enabled: false, recipients: [] },
    webhook: { enabled: true, url: `${base}/webhook` },
    ...overrides,
  };
}

function useConfig(value: NotifierConfig): void {
  setNotifierConfigSource(async () => value);
}

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      captured.push({ path, contentType: request.headers.get("content-type") ?? "", body: await request.text() });
      if (path === "/pushover" && failPushover) {
        return Response.json({ status: 0, errors: ["user identifier is invalid"] }, { status: 400 });
      }
      if (path === "/slow") await Bun.sleep(1_000);
      return Response.json({ status: 1 });
    },
  });
  base = `http://localhost:${server.port}`;
  process.env.PUSHOVER_API_URL = `${base}/pushover`;
  setNotifierLogger({ warn: (meta, message) => warnings.push({ meta, message }) });
});

afterAll(() => {
  server.stop(true);
  delete process.env.PUSHOVER_API_URL;
  setNotifierConfigSource(null);
});

afterEach(() => {
  captured.length = 0;
  warnings.length = 0;
  failPushover = false;
  setNotifyChannel("pushover", pushoverChannel);
  setNotifyChannel("email", emailChannel);
  setNotifyChannel("webhook", webhookChannel);
  setNotifyChannel("custom", null);
  setMailTransport(null);
});

describe("normalizeNotification", () => {
  test("truncates every field to the Pushover limits", () => {
    const normalized = normalizeNotification({
      title: "t".repeat(400),
      message: "m".repeat(2_000),
      url: "https://example.com/inquiries/1",
      urlTitle: "u".repeat(150),
    });
    expect(Array.from(normalized.title)).toHaveLength(NOTIFY_LIMITS.title);
    expect(normalized.title.endsWith("…")).toBe(true);
    expect(Array.from(normalized.message)).toHaveLength(NOTIFY_LIMITS.message);
    expect(Array.from(normalized.urlTitle ?? "")).toHaveLength(NOTIFY_LIMITS.urlTitle);
    expect(normalized.url).toBe("https://example.com/inquiries/1");
  });

  test("counts characters, not UTF-16 units, and drops an oversized URL", () => {
    const normalized = normalizeNotification({
      title: "가".repeat(250),
      message: "",
      url: `https://example.com/${"a".repeat(600)}`,
      urlTitle: "Open",
    });
    expect(normalized.title).toBe("가".repeat(250));
    expect(normalized.message).toBe(normalized.title);
    expect(normalized.url).toBeUndefined();
    expect(normalized.urlTitle).toBeUndefined();
  });

  test("clamps the priority to -2..1", () => {
    expect(clampPriority(undefined)).toBe(0);
    expect(clampPriority(Number.NaN)).toBe(0);
    expect(clampPriority(2)).toBe(1);
    expect(clampPriority(99)).toBe(1);
    expect(clampPriority(-5)).toBe(-2);
    expect(clampPriority(-1.7)).toBe(-1);
    expect(normalizeNotification({ title: "a", message: "b", priority: 2 }).priority).toBe(1);
  });
});

describe("notifyOperators", () => {
  test("posts the Pushover form and the webhook JSON", async () => {
    useConfig(config());
    const result = await notifyOperators({
      title: "New inquiry",
      message: "Someone wrote in",
      url: "https://example.com/admin/inquiries/7",
      urlTitle: "Open inquiry",
      priority: 5,
    });
    expect(result.ok).toBe(true);
    expect(result.channels).toEqual([
      { channel: "pushover", ok: true, skipped: false },
      { channel: "email", ok: false, skipped: true },
      { channel: "webhook", ok: true, skipped: false },
    ]);
    const pushover = captured.find((entry) => entry.path === "/pushover");
    expect(pushover?.contentType).toContain("application/x-www-form-urlencoded");
    const form = new URLSearchParams(pushover?.body ?? "");
    expect(Object.fromEntries(form)).toEqual({
      token: "app-token",
      user: "user-key",
      title: "New inquiry",
      message: "Someone wrote in",
      priority: "1",
      url: "https://example.com/admin/inquiries/7",
      url_title: "Open inquiry",
    });
    const webhook = captured.find((entry) => entry.path === "/webhook");
    expect(JSON.parse(webhook?.body ?? "{}")).toEqual({
      title: "New inquiry",
      message: "Someone wrote in",
      url: "https://example.com/admin/inquiries/7",
      priority: 1,
    });
  });

  test("isolates a failing channel and logs only the channel and reason", async () => {
    useConfig(config());
    failPushover = true;
    const result = await notifyOperators({ title: "Secret title", message: "private body" });
    expect(result.ok).toBe(true);
    expect(result.channels[0]).toEqual({
      channel: "pushover",
      ok: false,
      skipped: false,
      error: "HTTP 400: user identifier is invalid",
    });
    expect(result.channels[2]?.ok).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.meta).toEqual({ channel: "pushover", reason: "HTTP 400: user identifier is invalid" });
    expect(JSON.stringify(warnings)).not.toContain("private body");
    expect(JSON.stringify(warnings)).not.toContain("Secret title");
  });

  test("abandons a channel at its timeout without delaying the others", async () => {
    useConfig(config({ webhook: { enabled: true, url: `${base}/slow` } }));
    setNotifyChannel("custom", { send: () => new Promise(() => {}) });
    const started = Date.now();
    const result = await notifyOperators({ title: "a", message: "b" }, { timeoutMs: 100 });
    expect(Date.now() - started).toBeLessThan(900);
    expect(result.channels.find((entry) => entry.channel === "webhook")?.error).toBe("timeout");
    expect(result.channels.find((entry) => entry.channel === "custom")?.error).toBe("timeout");
    expect(result.channels.find((entry) => entry.channel === "pushover")?.ok).toBe(true);
  });

  test("skips disabled and incomplete channels", async () => {
    useConfig(config({
      pushover: { enabled: true, token: "", userKey: "user-key" },
      webhook: { enabled: false, url: `${base}/webhook` },
    }));
    const result = await notifyOperators({ title: "a", message: "b" });
    expect(result.ok).toBe(false);
    expect(result.channels.every((entry) => entry.skipped)).toBe(true);
    expect(captured).toHaveLength(0);
  });

  test("emails every recipient through the mailer", async () => {
    const sent: Array<Record<string, unknown>> = [];
    setMailTransport({
      sendMail: async (mail: Record<string, unknown>) => {
        sent.push(mail);
        return {};
      },
    } as unknown as Transporter);
    useConfig(config({
      pushover: { enabled: false, token: "", userKey: "" },
      email: { enabled: true, recipients: ["ops@example.com", "owner@example.com"] },
      webhook: { enabled: false, url: "" },
    }));
    const result = await notifyOperators({ title: "Job failed", message: "nightly export", url: "https://example.com/jobs/1" });
    expect(result.channels[1]).toEqual({ channel: "email", ok: true, skipped: false });
    expect(sent[0]?.to).toBe("ops@example.com, owner@example.com");
    expect(sent[0]?.subject).toBe("Job failed");
    expect(sent[0]?.text).toBe("nightly export\n\nhttps://example.com/jobs/1: https://example.com/jobs/1");
  });

  test("runs added channels, never throws, and falls back to the environment", async () => {
    const seen: string[] = [];
    setNotifyChannel("custom", { send: async (notification) => void seen.push(notification.title) });
    setNotifyChannel("email", null);
    setNotifierConfigSource(async () => {
      throw new Error("database down");
    });
    const env = envNotifierConfig({});
    expect(env.pushover.enabled).toBe(false);
    const result = await notifyOperators({ title: "Hello", message: "world" });
    expect(seen).toEqual(["Hello"]);
    expect(result.channels.map((entry) => entry.channel)).toEqual(["pushover", "webhook", "custom"]);

    setNotifyChannel("custom", { send: async () => { throw new Error("boom with user@example.com"); } });
    const failed = await notifyOperators({ title: "x", message: "y" });
    expect(failed.channels.at(-1)?.error).toBe("Error");
    expect(JSON.stringify(warnings)).not.toContain("user@example.com");
  });
});
