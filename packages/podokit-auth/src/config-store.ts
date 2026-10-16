import { decryptSecret } from "./secret";
import {
  type AuthConfig,
  type AuthConfigDefaults,
  type OAuthProviderConfig,
  envAuthConfig,
  resolveSessionIdleTimeoutMinutes,
  SUPPORTED_PROVIDER_IDS,
} from "./auth-config";

// Reads admin-managed auth config from the auth_config table (DB-first, env
// fallback per field) and, optionally, the app_setting key/value table, as one
// snapshot behind a short TTL. Safe to use from CJS/outside DI and by the runtime
// rebuild. When the repository offers a version probe, a TTL tick costs one cheap
// query and the tables are read again only after the probe changes. Values derived
// from a snapshot (decrypted config, capabilities, SMTP, setting projections) are
// computed once per change. Secrets are decrypted only here, in memory; a decrypt
// failure disables just that item (logged by key name only — never the secret).

export type SmtpConfig = { host: string; port: number; secure: boolean; user?: string; pass?: string; from?: string };

export type AuthConfigRow = {
  key: string;
  enabled: boolean;
  config: unknown;
  secret: string | null;
  updatedAt: Date | string | number;
};

export type AppSettingRow = { key: string; value: string };

/** Change tokens for the tables behind a snapshot, e.g. `count(*)` plus
 *  `max("updatedAt")`. The count catches deleted rows that were not the newest. */
export type ConfigVersions = { authConfig: string; appSettings: string };

export interface AuthConfigRepository {
  list(): Promise<readonly AuthConfigRow[]>;
  /** app_setting rows that share the snapshot (feature flags, site policy). */
  listSettings?(): Promise<readonly AppSettingRow[]>;
  /** Cheap change probe. Without it, every TTL tick reads the tables in full. */
  versions?(): Promise<ConfigVersions>;
}

export interface AuthConfigQueryClient {
  query<Row extends Record<string, unknown>>(
    sql: string,
  ): Promise<{ rows: Row[] }>;
}

export type CapabilitiesSnapshot = {
  providers: string[];
  requireEmailVerification: boolean;
  requireSignupApproval: boolean;
  allowDelete: boolean;
  passwordBreachCheck: boolean;
  auditLog: boolean;
  sessionIdleTimeoutMinutes: number | null;
};

export type ConfigStoreOptions = {
  /** How long a snapshot is served before the next version probe. Default 3000 ms. */
  ttlMs?: number;
  /** Values used when neither a row nor the environment sets one; see envAuthConfig(). */
  defaults?: AuthConfigDefaults;
};

export interface ConfigStore {
  /** Opaque token that changes whenever auth_config changes (drives auth rebuild). */
  currentVersion(): Promise<string>;
  /** Full resolved config for buildAuth(): DB rows override env field-by-field.
   *  The same object is returned until auth_config changes; treat it as read-only. */
  load(): Promise<AuthConfig>;
  /** SMTP transport config for the mailer (DB-first, env fallback). null → no SMTP.
   *  The same object is returned until auth_config changes; treat it as read-only. */
  smtpConfig(): Promise<SmtpConfig | null>;
  /** Booleans/provider names for the capabilities endpoint — never any secret. */
  capabilitiesSnapshot(): Promise<CapabilitiesSnapshot>;
  /** app_setting values by key. Empty when the repository has no settings or the read failed. */
  settings(): Promise<ReadonlyMap<string, string>>;
  /** A getter for a projection of app_setting that is recomputed only when the settings change. */
  selectSettings<T>(project: (settings: ReadonlyMap<string, string>) => T): () => Promise<T>;
  /** Forget the snapshot so the next read reloads every table, e.g. after a local write. */
  invalidate(): void;
}

export function createQueryAuthConfigRepository(
  client: AuthConfigQueryClient,
): AuthConfigRepository {
  return {
    list: async (): Promise<readonly AuthConfigRow[]> => {
      const result = await client.query<AuthConfigRow>(
        'SELECT "key", "enabled", "config", "secret", "updatedAt" FROM "auth_config"',
      );
      return result.rows;
    },
    versions: async (): Promise<ConfigVersions> => {
      const result = await client.query<{ count: unknown; updatedAt: unknown }>(
        'SELECT count(*) AS "count", CAST(max("updatedAt") AS TEXT) AS "updatedAt" FROM "auth_config"',
      );
      const row = result.rows[0];
      return { authConfig: `${String(row?.count ?? 0)}:${String(row?.updatedAt ?? "")}`, appSettings: "" };
    },
  };
}

function isRepository(source: AuthConfigRepository | AuthConfigQueryClient): source is AuthConfigRepository {
  return "list" in source && typeof source.list === "function";
}

const DEFAULT_TTL_MS = 3_000;
const NO_SETTINGS: ReadonlyMap<string, string> = new Map();

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function object(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      return object(JSON.parse(value) as unknown);
    } catch {
      return {};
    }
  }
  return {};
}

/** Recompute only when the source object changes identity. */
function memoize<S extends object, T>(source: () => S, compute: (value: S) => T): () => T {
  let key: S | undefined;
  let value: T | undefined;
  return (): T => {
    const current = source();
    if (key !== current) {
      value = compute(current);
      key = current;
    }
    return value as T;
  };
}

function oauthFromRow(row: AuthConfigRow): OAuthProviderConfig {
  const config = object(row.config);
  const clientId = typeof config.clientId === "string" ? config.clientId : "";
  const redirectURI = typeof config.redirectURI === "string" ? config.redirectURI : undefined;
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
function socialFrom(rs: readonly AuthConfigRow[], env: AuthConfig): Record<string, OAuthProviderConfig> {
  const social: Record<string, OAuthProviderConfig> = {};
  for (const row of rs) {
    if (!row.key.startsWith("social.")) continue;
    const id = row.key.slice("social.".length);
    if (!SUPPORTED_PROVIDER_IDS.has(id)) continue;
    social[id] = oauthFromRow(row);
  }
  for (const [id, provider] of Object.entries(env.social)) {
    if (!social[id]) social[id] = provider;
  }
  return social;
}

function configFrom(rs: readonly AuthConfigRow[], version: string, defaults: AuthConfigDefaults): AuthConfig {
  const env = envAuthConfig(defaults);
  const server = rs.find((r) => r.key === "server");
  const serverConfig = object(server?.config);
  return {
    version,
    social: socialFrom(rs, env),
    requireEmailVerification: server ? bool(serverConfig.requireEmailVerification, env.requireEmailVerification) : env.requireEmailVerification,
    requireSignupApproval: server ? bool(serverConfig.requireSignupApproval, env.requireSignupApproval) : env.requireSignupApproval,
    allowDelete: server ? bool(serverConfig.allowDelete, env.allowDelete) : env.allowDelete,
    hibp: server ? bool(serverConfig.hibp, env.hibp) : env.hibp,
    auditLog: server ? bool(serverConfig.auditLog, env.auditLog) : env.auditLog,
    sessionIdleTimeoutMinutes: server
      ? resolveSessionIdleTimeoutMinutes(serverConfig.sessionIdleTimeoutMinutes, env.sessionIdleTimeoutMinutes)
      : env.sessionIdleTimeoutMinutes,
  };
}

function smtpFrom(rs: readonly AuthConfigRow[]): SmtpConfig | null {
  const row = rs.find((r) => r.key === "smtp");
  const config = object(row?.config);
  if (row?.enabled && typeof config.host === "string" && config.host) {
    let pass: string | undefined;
    if (row.secret) {
      try {
        pass = decryptSecret(row.secret);
      } catch {
        console.warn('[auth-config] failed to decrypt SMTP password; sending without auth');
      }
    }
    return {
      host: config.host,
      port: typeof config.port === "number" ? config.port : 587,
      secure: bool(config.secure, false),
      user: typeof config.user === "string" ? config.user : undefined,
      pass,
      from: typeof config.from === "string" ? config.from : undefined,
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

function capabilitiesFrom(config: AuthConfig): CapabilitiesSnapshot {
  return {
    providers: Object.entries(config.social)
      .filter(([, p]) => p?.enabled && p.clientId && p.clientSecret)
      .map(([name]) => name),
    requireEmailVerification: config.requireEmailVerification,
    requireSignupApproval: config.requireSignupApproval,
    allowDelete: config.allowDelete,
    passwordBreachCheck: config.hibp,
    auditLog: config.auditLog,
    sessionIdleTimeoutMinutes: config.sessionIdleTimeoutMinutes,
  };
}

function signature(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
}

/** A table's last loaded content. A null token means "reload on the next tick". */
type Part<T> = { value: T; signature: string; token: string | null };

export function createConfigStore(
  source: AuthConfigRepository | AuthConfigQueryClient,
  options: ConfigStoreOptions = {},
): ConfigStore {
  const repository = isRepository(source) ? source : createQueryAuthConfigRepository(source);
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const defaults = options.defaults ?? {};
  let auth: Part<readonly AuthConfigRow[]> = { value: [], signature: "[]", token: null };
  let settingsPart: Part<ReadonlyMap<string, string>> = { value: NO_SETTINGS, signature: "[]", token: null };
  // Bumped whenever the auth_config content changes; the basis of currentVersion().
  let revision = 0;
  let checkedAt = 0;
  let generation = 0;
  let inflight: Promise<void> | null = null;

  function versionOf(rows: readonly AuthConfigRow[]): string {
    return rows.length === 0 ? "env" : `db:${revision}`;
  }

  // Keep the previous object when the content is unchanged, so memoized values survive.
  function nextAuth(rows: readonly AuthConfigRow[], token: string | null): void {
    // Without ORDER BY, row order may differ between reads of the same content.
    const sorted = [...rows].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const next = signature(sorted);
    if (next === auth.signature) {
      auth = { ...auth, token };
      return;
    }
    revision += 1;
    auth = { value: sorted, signature: next, token };
  }

  function nextSettings(rows: readonly AppSettingRow[], token: string | null): void {
    const next = signature(rows.map((row) => [row.key, row.value]).sort());
    if (next === settingsPart.signature) {
      settingsPart = { ...settingsPart, token };
      return;
    }
    settingsPart = { value: new Map(rows.map((row) => [row.key, row.value])), signature: next, token };
  }

  async function reload(started: number): Promise<void> {
    let versions: ConfigVersions | null = null;
    if (repository.versions) {
      try {
        versions = await repository.versions();
      } catch {
        // Table not migrated yet / DB blip → env fallback and setting defaults.
        if (started !== generation) return;
        nextAuth([], null);
        nextSettings([], null);
        return;
      }
    }
    const reloadAuth = versions === null || auth.token !== versions.authConfig;
    const reloadSettings = repository.listSettings !== undefined
      && (versions === null || settingsPart.token !== versions.appSettings);

    let rows: readonly AuthConfigRow[] | null = null;
    let authToken: string | null = null;
    if (reloadAuth) {
      try {
        rows = await repository.list();
        authToken = versions?.authConfig ?? null;
      } catch {
        rows = [];
      }
    }
    let settingRows: readonly AppSettingRow[] | null = null;
    let settingsToken: string | null = null;
    if (reloadSettings && repository.listSettings) {
      try {
        settingRows = await repository.listSettings();
        settingsToken = versions?.appSettings ?? null;
      } catch {
        settingRows = [];
      }
    }
    // An invalidate() during this read means it may predate a local write.
    if (started !== generation) return;
    if (rows) nextAuth(rows, authToken);
    if (settingRows) nextSettings(settingRows, settingsToken);
  }

  /** Serve the snapshot within the TTL; otherwise run one shared refresh. */
  function sync(): Promise<void> {
    if (checkedAt !== 0 && Date.now() - checkedAt < ttlMs) return Promise.resolve();
    if (inflight) return inflight;
    checkedAt = Date.now(); // set first so a slow/failing query still throttles retries
    const run = reload(generation).finally(() => {
      if (inflight === run) inflight = null;
    });
    inflight = run;
    return run;
  }

  function invalidate(): void {
    generation += 1;
    checkedAt = 0;
    inflight = null;
    auth = { ...auth, token: null };
    settingsPart = { ...settingsPart, token: null };
  }

  const config = memoize(() => auth.value, (rows) => configFrom(rows, versionOf(rows), defaults));
  const capabilities = memoize(config, capabilitiesFrom);
  const smtp = memoize(() => auth.value, smtpFrom);

  return {
    async currentVersion(): Promise<string> {
      await sync();
      return versionOf(auth.value);
    },
    async load(): Promise<AuthConfig> {
      await sync();
      return config();
    },
    async smtpConfig(): Promise<SmtpConfig | null> {
      await sync();
      return smtp();
    },
    async capabilitiesSnapshot(): Promise<CapabilitiesSnapshot> {
      await sync();
      const snapshot = capabilities();
      return { ...snapshot, providers: [...snapshot.providers] };
    },
    async settings(): Promise<ReadonlyMap<string, string>> {
      await sync();
      return settingsPart.value;
    },
    selectSettings<T>(project: (settings: ReadonlyMap<string, string>) => T): () => Promise<T> {
      const select = memoize(() => settingsPart.value, project);
      return async (): Promise<T> => {
        await sync();
        return select();
      };
    },
    invalidate,
  };
}
