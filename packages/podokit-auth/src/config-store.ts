import type { Pool } from "pg";
import { decryptSecret } from "./secret";
import {
  type AuthConfig,
  type OAuthProviderConfig,
  envAuthConfig,
  resolveSessionIdleTimeoutMinutes,
  SUPPORTED_PROVIDER_IDS,
} from "./auth-config";

// Reads admin-managed auth config from the auth_config table (DB-first, env
// fallback per field) behind a short TTL cache — the same pooled-read pattern as
// feature-gate.ts, safe to use from CJS/outside DI and by the runtime rebuild.
// Secrets are decrypted only here, in memory, at read time; a decrypt failure
// disables just that item (logged by key name only — never the secret).

export type SmtpConfig = { host: string; port: number; secure: boolean; user?: string; pass?: string; from?: string };

type Row = { key: string; enabled: boolean; config: Record<string, unknown>; secret: string | null; updatedAt: Date };

const TTL_MS = 3_000;

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

export function createConfigStore(pool: Pool) {
  let cache: Row[] = [];
  let fetchedAt = 0;

  /** Drop the local TTL snapshot after an in-process configuration write. */
  function invalidate(): void {
    cache = [];
    fetchedAt = 0;
  }

  async function rows(): Promise<Row[]> {
    if (fetchedAt !== 0 && Date.now() - fetchedAt < TTL_MS) return cache;
    fetchedAt = Date.now(); // set first so a slow/failing query still throttles retries
    try {
      const res = await pool.query<Row>('SELECT "key", "enabled", "config", "secret", "updatedAt" FROM "auth_config"');
      cache = res.rows;
    } catch {
      cache = []; // table not migrated yet / DB blip → env fallback
    }
    return cache;
  }

  function versionOf(rs: Row[]): string {
    if (rs.length === 0) return "env";
    const latest = rs.reduce((max, r) => Math.max(max, new Date(r.updatedAt).getTime()), 0);
    return `db:${latest}`;
  }

  function oauthFromRow(row: Row): OAuthProviderConfig {
    const clientId = typeof row.config.clientId === "string" ? row.config.clientId : "";
    const redirectURI = typeof row.config.redirectURI === "string" ? row.config.redirectURI : undefined;
    let clientSecret = "";
    if (row.secret) {
      try {
        clientSecret = decryptSecret(row.secret);
      } catch {
        console.warn(`[auth-config] failed to decrypt secret for "${row.key}" (wrong BETTER_AUTH_SECRET?); provider disabled`);
        return { enabled: false, clientId, clientSecret: "", redirectURI };
      }
    }
    return { enabled: row.enabled, clientId, clientSecret, redirectURI };
  }

  // Resolve the full social-provider map: every `social.<id>` DB row for a
  // supported provider, then env fallback for google/github when they have no row.
  function socialFrom(rs: Row[]): Record<string, OAuthProviderConfig> {
    const social: Record<string, OAuthProviderConfig> = {};
    for (const row of rs) {
      if (!row.key.startsWith("social.")) continue;
      const id = row.key.slice("social.".length);
      if (!SUPPORTED_PROVIDER_IDS.has(id)) continue;
      social[id] = oauthFromRow(row);
    }
    for (const [id, provider] of Object.entries(envAuthConfig().social)) {
      if (!social[id]) social[id] = provider;
    }
    return social;
  }

  /** Opaque token that changes whenever config changes (drives auth rebuild). */
  async function currentVersion(): Promise<string> {
    return versionOf(await rows());
  }

  /** Full resolved config for buildAuth(): DB rows override env field-by-field. */
  async function load(): Promise<AuthConfig> {
    const rs = await rows();
    const env = envAuthConfig();
    const server = rs.find((r) => r.key === "server");
    return {
      version: versionOf(rs),
      social: socialFrom(rs),
      requireEmailVerification: server ? bool(server.config.requireEmailVerification, env.requireEmailVerification) : env.requireEmailVerification,
      requireSignupApproval: server ? bool(server.config.requireSignupApproval, env.requireSignupApproval) : env.requireSignupApproval,
      allowDelete: server ? bool(server.config.allowDelete, env.allowDelete) : env.allowDelete,
      hibp: server ? bool(server.config.hibp, env.hibp) : env.hibp,
      auditLog: server ? bool(server.config.auditLog, env.auditLog) : env.auditLog,
      sessionIdleTimeoutMinutes: server
        ? resolveSessionIdleTimeoutMinutes(server.config.sessionIdleTimeoutMinutes, env.sessionIdleTimeoutMinutes)
        : env.sessionIdleTimeoutMinutes,
    };
  }

  /** SMTP transport config for the mailer (DB-first, env fallback). null → no SMTP. */
  async function smtpConfig(): Promise<SmtpConfig | null> {
    const row = (await rows()).find((r) => r.key === "smtp");
    if (row?.enabled && typeof row.config.host === "string" && row.config.host) {
      let pass: string | undefined;
      if (row.secret) {
        try {
          pass = decryptSecret(row.secret);
        } catch {
          console.warn('[auth-config] failed to decrypt SMTP password; sending without auth');
        }
      }
      return {
        host: row.config.host,
        port: typeof row.config.port === "number" ? row.config.port : 587,
        secure: bool(row.config.secure, false),
        user: typeof row.config.user === "string" ? row.config.user : undefined,
        pass,
        from: typeof row.config.from === "string" ? row.config.from : undefined,
      };
    }
    if (process.env.SMTP_HOST) {
      return {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 1025),
        secure: process.env.SMTP_SECURE === "true",
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
        from: process.env.MAIL_FROM,
      };
    }
    return null;
  }

  /** Booleans/provider names for the capabilities endpoint — never any secret. */
  async function capabilitiesSnapshot(): Promise<{
    providers: string[];
    requireEmailVerification: boolean;
    requireSignupApproval: boolean;
    allowDelete: boolean;
    passwordBreachCheck: boolean;
    auditLog: boolean;
    sessionIdleTimeoutMinutes: number | null;
  }> {
    const cfg = await load();
    return {
      providers: Object.entries(cfg.social)
        .filter(([, p]) => p?.enabled && p.clientId && p.clientSecret)
        .map(([name]) => name),
      requireEmailVerification: cfg.requireEmailVerification,
      requireSignupApproval: cfg.requireSignupApproval,
      allowDelete: cfg.allowDelete,
      passwordBreachCheck: cfg.hibp,
      auditLog: cfg.auditLog,
      sessionIdleTimeoutMinutes: cfg.sessionIdleTimeoutMinutes,
    };
  }

  return { currentVersion, load, smtpConfig, capabilitiesSnapshot, invalidate };
}
