import { sendMail } from "../mail/mailer";
import { envNotifierConfig, isHttpUrl, type NotifierConfig } from "./notifier-config";

// Operator notifications: tell the people who run the app that something needs
// attention (a new inquiry, a sign-up awaiting approval, a failed job). Every
// enabled channel runs in parallel with its own timeout, a failing channel never
// affects the others, and notifyOperators never throws, so callers can fire it
// from a request handler without guarding it. Failures are logged with the
// channel name and a short reason only — never the message body.

export const NOTIFY_TIMEOUT_MS = 5_000;
export const DEFAULT_PUSHOVER_API_URL = "https://api.pushover.net/1/messages.json";

/** Pushover's documented field limits; other channels receive the same values. */
export const NOTIFY_LIMITS = { title: 250, message: 1024, url: 512, urlTitle: 100 } as const;

export type OperatorNotification = {
  title: string;
  message: string;
  url?: string;
  urlTitle?: string;
  /** Pushover priority: -2 lowest … 1 high. Values outside are clamped. */
  priority?: number;
};

/** A notification after truncation and clamping; what every channel receives. */
export type NormalizedNotification = {
  title: string;
  message: string;
  url?: string;
  urlTitle?: string;
  priority: number;
};

export type ChannelResult = {
  channel: string;
  ok: boolean;
  /** True when the channel is disabled or not configured. */
  skipped: boolean;
  error?: string;
};

export type NotifyResult = { ok: boolean; channels: ChannelResult[] };

export interface NotifyChannel {
  /** Whether the channel should run with this configuration. Defaults to true. */
  enabled?(config: NotifierConfig): boolean;
  /** Deliver the notification. Honour `signal`; the call is abandoned when it fires. */
  send(notification: NormalizedNotification, signal: AbortSignal, config: NotifierConfig): Promise<void>;
}

/** Throw this from a channel for a failure reason that is safe to log and show. */
export class NotifyChannelError extends Error {
  override name = "NotifyChannelError";
}

export type NotifierLogger = { warn(meta: Record<string, unknown>, message: string): void };

let configSource: () => Promise<NotifierConfig> = async () => envNotifierConfig();
let logger: NotifierLogger = {
  warn: (meta, message) => console.warn(`[notifier] ${message}`, JSON.stringify(meta)),
};

/** Where the channel settings come from; the notifier module points this at auth_config. */
export function setNotifierConfigSource(source: (() => Promise<NotifierConfig>) | null): void {
  configSource = source ?? (async () => envNotifierConfig());
}

export function setNotifierLogger(next: NotifierLogger): void {
  logger = next;
}

function truncate(value: string, limit: number): string {
  const chars = Array.from(value);
  return chars.length <= limit ? value : `${chars.slice(0, limit - 1).join("")}…`;
}

export function clampPriority(priority: number | undefined): number {
  if (typeof priority !== "number" || !Number.isFinite(priority)) return 0;
  return Math.min(1, Math.max(-2, Math.trunc(priority)));
}

/** Applies the field limits. A URL longer than its limit is dropped rather than
 *  cut, because a truncated link points somewhere else. */
export function normalizeNotification(notification: OperatorNotification): NormalizedNotification {
  const title = truncate(notification.title.trim() || "Notification", NOTIFY_LIMITS.title);
  const message = truncate(notification.message.trim() || title, NOTIFY_LIMITS.message);
  const url = notification.url?.trim();
  const keepUrl = url !== undefined && url.length > 0 && Array.from(url).length <= NOTIFY_LIMITS.url;
  const urlTitle = notification.urlTitle?.trim();
  return {
    title,
    message,
    ...(keepUrl ? { url } : {}),
    ...(keepUrl && urlTitle ? { urlTitle: truncate(urlTitle, NOTIFY_LIMITS.urlTitle) } : {}),
    priority: clampPriority(notification.priority),
  };
}

async function failOnHttpError(response: Response, readErrors: boolean): Promise<void> {
  if (response.ok) return;
  let detail = "";
  if (readErrors) {
    try {
      const body = (await response.json()) as { errors?: unknown };
      if (Array.isArray(body.errors)) {
        detail = body.errors.filter((entry): entry is string => typeof entry === "string").join("; ");
      }
    } catch {
      /* no JSON body */
    }
  }
  throw new NotifyChannelError(truncate(`HTTP ${response.status}${detail ? `: ${detail}` : ""}`, 200));
}

export const pushoverChannel: NotifyChannel = {
  enabled: (config) => config.pushover.enabled && Boolean(config.pushover.token && config.pushover.userKey),
  send: async (notification, signal, config) => {
    const form = new URLSearchParams({
      token: config.pushover.token,
      user: config.pushover.userKey,
      title: notification.title,
      message: notification.message,
      priority: String(notification.priority),
    });
    if (notification.url) form.set("url", notification.url);
    if (notification.urlTitle) form.set("url_title", notification.urlTitle);
    const response = await fetch(process.env.PUSHOVER_API_URL || DEFAULT_PUSHOVER_API_URL, {
      method: "POST",
      body: form,
      signal,
    });
    await failOnHttpError(response, true);
  },
};

export const emailChannel: NotifyChannel = {
  enabled: (config) => config.email.enabled && config.email.recipients.length > 0,
  send: async (notification, _signal, config) => {
    const link = notification.url ? `\n\n${notification.urlTitle ?? notification.url}: ${notification.url}` : "";
    await sendMail({
      to: config.email.recipients.join(", "),
      subject: notification.title,
      text: `${notification.message}${link}`,
    });
  },
};

export const webhookChannel: NotifyChannel = {
  enabled: (config) => config.webhook.enabled && config.webhook.url.length > 0,
  send: async (notification, signal, config) => {
    if (!isHttpUrl(config.webhook.url)) throw new NotifyChannelError("invalid webhook URL");
    const response = await fetch(config.webhook.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: notification.title,
        message: notification.message,
        url: notification.url ?? null,
        priority: notification.priority,
      }),
      signal,
    });
    await failOnHttpError(response, false);
  },
};

const channels = new Map<string, NotifyChannel>([
  ["pushover", pushoverChannel],
  ["email", emailChannel],
  ["webhook", webhookChannel],
]);

/** Add or replace a channel by name (e.g. "slack"), or pass null to remove one,
 *  built-ins included. Call it from apps/api/src/app.extensions.ts. */
export function setNotifyChannel(name: string, channel: NotifyChannel | null): void {
  if (channel) channels.set(name, channel);
  else channels.delete(name);
}

export function notifyChannelNames(): string[] {
  return [...channels.keys()];
}

/** A reason that names what failed without echoing payloads or addresses. */
function failureReason(error: unknown, signal: AbortSignal): string {
  if (signal.aborted) return "timeout";
  if (error instanceof NotifyChannelError) return error.message;
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
    return error.name || "Error";
  }
  return "unknown error";
}

function abandonOn(signal: AbortSignal): { promise: Promise<never>; release: () => void } {
  let release = (): void => {};
  const promise = new Promise<never>((_resolve, reject) => {
    const onAbort = (): void => reject(new NotifyChannelError("timeout"));
    if (signal.aborted) onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    release = () => signal.removeEventListener("abort", onAbort);
  });
  return { promise, release };
}

async function runChannel(
  name: string,
  channel: NotifyChannel,
  notification: NormalizedNotification,
  config: NotifierConfig,
  timeoutMs: number,
): Promise<ChannelResult> {
  let enabled: boolean;
  try {
    enabled = channel.enabled ? channel.enabled(config) : true;
  } catch {
    enabled = false;
  }
  if (!enabled) return { channel: name, ok: false, skipped: true };

  const signal = AbortSignal.timeout(timeoutMs);
  const abandon = abandonOn(signal);
  try {
    const sending = Promise.resolve().then(() => channel.send(notification, signal, config));
    // A channel that ignores the signal must not reject unobserved after we give up.
    sending.catch(() => {});
    await Promise.race([sending, abandon.promise]);
    return { channel: name, ok: true, skipped: false };
  } catch (error) {
    const reason = failureReason(error, signal);
    logger.warn({ channel: name, reason }, "Deliver operator notification failed");
    return { channel: name, ok: false, skipped: false, error: reason };
  } finally {
    abandon.release();
  }
}

/** Send a notification to every enabled operator channel. Never throws. */
export async function notifyOperators(
  notification: OperatorNotification,
  options: { timeoutMs?: number } = {},
): Promise<NotifyResult> {
  try {
    const normalized = normalizeNotification(notification);
    let config: NotifierConfig;
    try {
      config = await configSource();
    } catch {
      config = envNotifierConfig();
    }
    const timeoutMs = options.timeoutMs ?? NOTIFY_TIMEOUT_MS;
    const entries = [...channels];
    const settled = await Promise.allSettled(
      entries.map(([name, channel]) => runChannel(name, channel, normalized, config, timeoutMs)),
    );
    const results = settled.map((outcome, index): ChannelResult =>
      outcome.status === "fulfilled"
        ? outcome.value
        : { channel: entries[index]?.[0] ?? "unknown", ok: false, skipped: false, error: "unknown error" }
    );
    return { ok: results.some((result) => result.ok), channels: results };
  } catch (error) {
    logger.warn(
      { reason: error instanceof Error ? error.name : "unknown error" },
      "Prepare operator notification failed",
    );
    return { ok: false, channels: [] };
  }
}
