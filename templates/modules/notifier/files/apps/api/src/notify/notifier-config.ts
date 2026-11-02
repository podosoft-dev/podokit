import type { SQL } from "bun";
import { AppException } from "@podosoft/podokit-contracts";
import { decryptSecret, encryptSecret } from "@podosoft/podokit-auth";
import type { DatabaseProviderName } from "@podosoft/podokit-runtime";

// Operator-notification settings. With the auth module installed, administrators
// store them in the shared auth_config table (one row per channel, secrets
// encrypted with the key derived from BETTER_AUTH_SECRET) and changes apply
// without a restart. Every field falls back to its environment variable, and an
// app without the auth_config table uses the environment only.

/** auth_config row keys, one per built-in channel. */
export const NOTIFY_KEYS = {
  pushover: "notify.pushover",
  email: "notify.email",
  webhook: "notify.webhook",
} as const;

export const MAX_RECIPIENTS = 20;
const MAX_URL_LENGTH = 2048;
const MAX_SECRET_LENGTH = 512;
const CACHE_TTL_MS = 3_000;
const EMAIL_PATTERN = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

export type NotifierConfig = {
  pushover: { enabled: boolean; token: string; userKey: string };
  email: { enabled: boolean; recipients: string[] };
  webhook: { enabled: boolean; url: string };
};

/** What GET returns: secrets are reported only as present or absent. */
export type NotifierView = {
  pushover: { enabled: boolean; hasToken: boolean; hasUserKey: boolean };
  email: { enabled: boolean; recipients: string[] };
  webhook: { enabled: boolean; hasUrl: boolean };
};

/** A secret set to null is removed (the environment applies again); an empty
 *  string or an absent field keeps the stored value. */
export type NotifierUpdate = {
  pushover?: { enabled?: boolean; token?: string | null; userKey?: string | null };
  email?: { enabled?: boolean; recipients?: string[] };
  webhook?: { enabled?: boolean; url?: string | null };
};

type Env = Record<string, string | undefined>;

export type NotifyConfigRow = {
  key: string;
  enabled: boolean;
  config: Record<string, unknown>;
  secret: string | null;
};

type StoredRow = { key: string; enabled: boolean | number; config: unknown; secret: string | null };

function objectOf(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      return objectOf(JSON.parse(value) as unknown);
    } catch {
      return {};
    }
  }
  return {};
}

/** Splits a comma-separated recipient list and drops blanks and duplicates. */
export function parseRecipients(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean))];
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function decrypt(row: NotifyConfigRow | undefined, onError: (key: string) => void): string {
  if (!row?.secret) return "";
  try {
    return decryptSecret(row.secret);
  } catch {
    onError(row.key);
    return "";
  }
}

function pushoverSecrets(row: NotifyConfigRow | undefined, onError: (key: string) => void): {
  token?: string;
  userKey?: string;
} {
  const plain = decrypt(row, onError);
  if (!plain) return {};
  const parsed = objectOf(plain);
  return {
    ...(typeof parsed.token === "string" && parsed.token ? { token: parsed.token } : {}),
    ...(typeof parsed.userKey === "string" && parsed.userKey ? { userKey: parsed.userKey } : {}),
  };
}

/** Resolves the effective configuration: a stored row decides `enabled`, and each
 *  field falls back to its environment variable. Without a row, a channel is on
 *  when its environment variables are complete. */
export function resolveNotifierConfig(
  rows: readonly NotifyConfigRow[],
  env: Env = process.env,
  onDecryptError: (key: string) => void = () => {},
): NotifierConfig {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const pushoverRow = byKey.get(NOTIFY_KEYS.pushover);
  const emailRow = byKey.get(NOTIFY_KEYS.email);
  const webhookRow = byKey.get(NOTIFY_KEYS.webhook);

  const secrets = pushoverSecrets(pushoverRow, onDecryptError);
  const token = secrets.token ?? env.PUSHOVER_APP_TOKEN ?? "";
  const userKey = secrets.userKey ?? env.PUSHOVER_USER_KEY ?? "";

  const storedRecipients = emailRow?.config.recipients;
  const recipients = Array.isArray(storedRecipients) && storedRecipients.length > 0
    ? storedRecipients.filter((entry): entry is string => typeof entry === "string")
    : parseRecipients(env.NOTIFY_EMAIL_TO);

  const url = decrypt(webhookRow, onDecryptError) || (env.NOTIFY_WEBHOOK_URL ?? "");

  return {
    pushover: { enabled: pushoverRow ? pushoverRow.enabled : Boolean(token && userKey), token, userKey },
    email: { enabled: emailRow ? emailRow.enabled : recipients.length > 0, recipients },
    webhook: { enabled: webhookRow ? webhookRow.enabled : Boolean(url), url },
  };
}

/** The configuration from the environment alone. */
export function envNotifierConfig(env: Env = process.env): NotifierConfig {
  return resolveNotifierConfig([], env);
}

export function describeNotifierConfig(config: NotifierConfig): NotifierView {
  return {
    pushover: {
      enabled: config.pushover.enabled,
      hasToken: config.pushover.token.length > 0,
      hasUserKey: config.pushover.userKey.length > 0,
    },
    email: { enabled: config.email.enabled, recipients: [...config.email.recipients] },
    webhook: { enabled: config.webhook.enabled, hasUrl: config.webhook.url.length > 0 },
  };
}

function invalid(message: string): AppException {
  return new AppException("NOTIFIER_CONFIG_INVALID", message, 400);
}

function checkSecret(value: string | null | undefined, field: string): void {
  if (typeof value === "string" && value.length > MAX_SECRET_LENGTH) {
    throw invalid(`${field} must be at most ${MAX_SECRET_LENGTH} characters`);
  }
}

/** Rejects malformed updates before anything is written. */
export function validateNotifierUpdate(update: NotifierUpdate): void {
  checkSecret(update.pushover?.token, "Pushover token");
  checkSecret(update.pushover?.userKey, "Pushover user key");
  const recipients = update.email?.recipients;
  if (recipients) {
    if (recipients.length > MAX_RECIPIENTS) {
      throw invalid(`At most ${MAX_RECIPIENTS} recipients are allowed`);
    }
    if (recipients.some((entry) => !EMAIL_PATTERN.test(entry.trim()))) {
      throw invalid("Every recipient must be an email address");
    }
  }
  const url = update.webhook?.url;
  if (typeof url === "string" && url.length > 0) {
    if (url.length > MAX_URL_LENGTH || !isHttpUrl(url)) {
      throw invalid("The webhook URL must be an http or https URL");
    }
  }
}

/** Applies an update to the stored rows (pure; secrets are re-encrypted by `seal`). */
export function applyNotifierUpdate(
  rows: readonly NotifyConfigRow[],
  update: NotifierUpdate,
  current: NotifierConfig,
  seal: (plain: string) => string = encryptSecret,
  onDecryptError: (key: string) => void = () => {},
): NotifyConfigRow[] {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const changed: NotifyConfigRow[] = [];

  if (update.pushover) {
    const key = NOTIFY_KEYS.pushover;
    const row = byKey.get(key);
    const secrets = pushoverSecrets(row, onDecryptError);
    const { token, userKey } = update.pushover;
    if (token === null) delete secrets.token;
    else if (token) secrets.token = token.trim();
    if (userKey === null) delete secrets.userKey;
    else if (userKey) secrets.userKey = userKey.trim();
    changed.push({
      key,
      enabled: update.pushover.enabled ?? row?.enabled ?? current.pushover.enabled,
      config: row?.config ?? {},
      secret: secrets.token || secrets.userKey ? seal(JSON.stringify(secrets)) : null,
    });
  }

  if (update.email) {
    const key = NOTIFY_KEYS.email;
    const row = byKey.get(key);
    const config = { ...(row?.config ?? {}) };
    if (update.email.recipients) {
      config.recipients = [...new Set(update.email.recipients.map((entry) => entry.trim()))];
    }
    changed.push({
      key,
      enabled: update.email.enabled ?? row?.enabled ?? current.email.enabled,
      config,
      secret: null,
    });
  }

  if (update.webhook) {
    const key = NOTIFY_KEYS.webhook;
    const row = byKey.get(key);
    const { url } = update.webhook;
    let secret = row?.secret ?? null;
    if (url === null) secret = null;
    else if (url) secret = seal(url.trim());
    changed.push({
      key,
      enabled: update.webhook.enabled ?? row?.enabled ?? current.webhook.enabled,
      config: row?.config ?? {},
      secret,
    });
  }
  return changed;
}

type DecryptWarning = (key: string) => void;

/** Reads and writes the notification rows of auth_config, caching the effective
 *  configuration briefly so a burst of notifications reads the table once. */
export class NotifierSettings {
  private cached: { at: number; value: NotifierConfig } | null = null;

  constructor(
    private readonly sql: SQL,
    private readonly provider: DatabaseProviderName = "postgres",
    private readonly env: Env = process.env,
    private readonly onDecryptError: DecryptWarning = () => {},
    private readonly ttlMs = CACHE_TTL_MS,
  ) {}

  private async rows(): Promise<NotifyConfigRow[]> {
    const stored = await this.sql<StoredRow[]>`
      SELECT "key", "enabled", "config", "secret" FROM "auth_config"
      WHERE "key" LIKE ${"notify.%"}
    `;
    return stored.map((row) => ({
      key: row.key,
      enabled: row.enabled === true || row.enabled === 1,
      config: objectOf(row.config),
      secret: row.secret,
    }));
  }

  /** The effective configuration; the environment alone when the table is absent. */
  async config(): Promise<NotifierConfig> {
    if (this.cached && Date.now() - this.cached.at < this.ttlMs) return this.cached.value;
    let value: NotifierConfig;
    try {
      value = resolveNotifierConfig(await this.rows(), this.env, this.onDecryptError);
    } catch {
      value = envNotifierConfig(this.env);
    }
    this.cached = { at: Date.now(), value };
    return value;
  }

  invalidate(): void {
    this.cached = null;
  }

  async describe(): Promise<NotifierView> {
    this.invalidate();
    return describeNotifierConfig(await this.config());
  }

  async update(update: NotifierUpdate): Promise<NotifierView> {
    validateNotifierUpdate(update);
    const rows = await this.rows();
    const current = resolveNotifierConfig(rows, this.env, this.onDecryptError);
    for (const row of applyNotifierUpdate(rows, update, current, encryptSecret, this.onDecryptError)) {
      await this.write(row);
    }
    return this.describe();
  }

  private async write(row: NotifyConfigRow): Promise<void> {
    // PostgreSQL stores a jsonb object only when bound as an object, while
    // SQLite keeps the column as text.
    const config = this.provider === "sqlite" ? JSON.stringify(row.config) : row.config;
    await this.sql`
      INSERT INTO "auth_config" ("key", "enabled", "config", "secret", "updatedAt")
      VALUES (${row.key}, ${row.enabled}, ${config}, ${row.secret}, CURRENT_TIMESTAMP)
      ON CONFLICT ("key") DO UPDATE SET
        "enabled" = EXCLUDED."enabled",
        "config" = EXCLUDED."config",
        "secret" = EXCLUDED."secret",
        "updatedAt" = CURRENT_TIMESTAMP
    `;
  }
}
