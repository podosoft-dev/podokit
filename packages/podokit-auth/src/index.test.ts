import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  type AppSettingRow,
  type AuthConfigQueryClient,
  type AuthConfigRow,
  type ConfigVersions,
  DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES,
  MAX_SESSION_IDLE_TIMEOUT_MINUTES,
  MIN_SESSION_IDLE_TIMEOUT_MINUTES,
  decryptSecret,
  encryptSecret,
  envAuthConfig,
  isSessionIdleTimeoutMinutes,
  resolveSessionIdleTimeoutMinutes,
  sessionIdleOptions,
  socialKey,
  SUPPORTED_PROVIDER_IDS,
  createConfigStore,
} from "./index";

describe("secret envelope", () => {
  it("round-trips a value", () => {
    const secret = "s3cr3t-value";
    const envelope = encryptSecret(secret);
    expect(envelope).not.toContain(secret);
    expect(envelope.split("|")).toHaveLength(3);
    expect(decryptSecret(envelope)).toBe(secret);
  });
  it("rejects a tampered envelope", () => {
    const envelope = encryptSecret("x");
    const [iv, tag, ct] = envelope.split("|");
    expect(() => decryptSecret(`${iv}|${tag}|${Buffer.from("nope").toString("base64")}`)).toThrow();
  });
  it("throws on a malformed envelope", () => {
    expect(() => decryptSecret("not-an-envelope")).toThrow(/malformed/);
  });
});

describe("auth-config helpers", () => {
  it("envAuthConfig returns a config object", () => {
    const config = envAuthConfig();
    expect(config).toHaveProperty("social");
    expect(config).toHaveProperty("requireSignupApproval");
    expect(config.version).toBe("env");
  });
  it("reads the sign-up approval environment fallback", () => {
    const previous = process.env.AUTH_REQUIRE_SIGNUP_APPROVAL;
    try {
      process.env.AUTH_REQUIRE_SIGNUP_APPROVAL = "true";
      expect(envAuthConfig().requireSignupApproval).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.AUTH_REQUIRE_SIGNUP_APPROVAL;
      else process.env.AUTH_REQUIRE_SIGNUP_APPROVAL = previous;
    }
  });
  it("reads and validates the session idle-timeout environment fallback", () => {
    const previous = process.env.AUTH_SESSION_IDLE_TIMEOUT_MINUTES;
    try {
      process.env.AUTH_SESSION_IDLE_TIMEOUT_MINUTES = String(DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES);
      expect(envAuthConfig().sessionIdleTimeoutMinutes).toBe(DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES);
      process.env.AUTH_SESSION_IDLE_TIMEOUT_MINUTES = "4";
      expect(envAuthConfig().sessionIdleTimeoutMinutes).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.AUTH_SESSION_IDLE_TIMEOUT_MINUTES;
      else process.env.AUTH_SESSION_IDLE_TIMEOUT_MINUTES = previous;
    }
  });
  it("normalizes idle timeout values and builds sliding session options", () => {
    expect(isSessionIdleTimeoutMinutes(null)).toBe(true);
    expect(isSessionIdleTimeoutMinutes(MIN_SESSION_IDLE_TIMEOUT_MINUTES)).toBe(true);
    expect(isSessionIdleTimeoutMinutes(MAX_SESSION_IDLE_TIMEOUT_MINUTES)).toBe(true);
    expect(isSessionIdleTimeoutMinutes(MIN_SESSION_IDLE_TIMEOUT_MINUTES - 1)).toBe(false);
    expect(isSessionIdleTimeoutMinutes(MAX_SESSION_IDLE_TIMEOUT_MINUTES + 1)).toBe(false);
    expect(isSessionIdleTimeoutMinutes(30.5)).toBe(false);
    expect(resolveSessionIdleTimeoutMinutes("30", null)).toBeNull();
    expect(sessionIdleOptions(null)).toBeUndefined();
    expect(sessionIdleOptions(30)).toEqual({ expiresIn: 1_800, updateAge: 60 });
  });
  it("SUPPORTED_PROVIDER_IDS gates provider keys and socialKey formats", () => {
    expect(SUPPORTED_PROVIDER_IDS.has("google")).toBe(true);
    expect(socialKey("google")).toBe("social.google");
  });

  it("normalizes JSON text returned by Bun's pg compatibility layer", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{
        key: "server",
        enabled: true,
        config: '{"auditLog":false,"allowDelete":true}',
        secret: null,
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      }],
    });
    const store = createConfigStore({ query });

    await expect(store.capabilitiesSnapshot()).resolves.toMatchObject({
      auditLog: false,
      allowDelete: true,
    });
  });

  it("loads configuration through a database-neutral repository", async () => {
    const list = vi.fn().mockResolvedValue([{
      key: "server",
      enabled: true,
      config: { auditLog: true },
      secret: null,
      updatedAt: "2026-01-02T00:00:00Z",
    }]);
    const store = createConfigStore({ list });
    await expect(store.capabilitiesSnapshot()).resolves.toMatchObject({ auditLog: true });
    expect(list).toHaveBeenCalledTimes(1);
  });
});

type FakeSettingRow = AppSettingRow & { updatedAt?: string };
type FakeTables = {
  auth: AuthConfigRow[];
  settings: FakeSettingRow[];
};

/** A repository over in-memory tables whose probe mirrors count(*) + max(updatedAt). */
function fakeRepository(tables: FakeTables) {
  const token = (rows: ReadonlyArray<{ updatedAt?: AuthConfigRow["updatedAt"] }>): string =>
    `${rows.length}:${rows.reduce((max, row) => Math.max(max, row.updatedAt === undefined ? 0 : new Date(row.updatedAt).getTime()), 0)}`;
  const versions = vi.fn(async (): Promise<ConfigVersions> => ({
    authConfig: token(tables.auth),
    appSettings: token(tables.settings),
  }));
  const list = vi.fn(async (): Promise<readonly AuthConfigRow[]> => tables.auth.map((row) => ({ ...row })));
  const listSettings = vi.fn(async (): Promise<readonly AppSettingRow[]> =>
    tables.settings.map((row) => ({ key: row.key, value: row.value })));
  return { versions, list, listSettings };
}

function providerRow(id: string, updatedAt: string): AuthConfigRow {
  return { key: socialKey(id), enabled: true, config: { clientId: `${id}-id` }, secret: encryptSecret(`${id}-secret`), updatedAt };
}

describe("config store snapshot", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves one snapshot within the TTL and only probes when nothing changed", async () => {
    const tables: FakeTables = {
      auth: [providerRow("google", "2026-01-01T00:00:00Z")],
      settings: [{ key: "magicLink", value: "false" }],
    };
    const repository = fakeRepository(tables);
    const store = createConfigStore(repository);

    await store.load();
    await store.capabilitiesSnapshot();
    await store.settings();
    expect(repository.versions).toHaveBeenCalledTimes(1);
    expect(repository.list).toHaveBeenCalledTimes(1);
    expect(repository.listSettings).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3_100);
    await store.load();
    expect(repository.versions).toHaveBeenCalledTimes(2);
    expect(repository.list).toHaveBeenCalledTimes(1);
    expect(repository.listSettings).toHaveBeenCalledTimes(1);
  });

  it("reloads only the table whose version changed", async () => {
    const tables: FakeTables = {
      auth: [providerRow("google", "2026-01-01T00:00:00Z")],
      settings: [{ key: "magicLink", value: "true", updatedAt: "2026-01-01T00:00:00Z" }],
    };
    const repository = fakeRepository(tables);
    const store = createConfigStore(repository);
    const magicLink = store.selectSettings((settings) => settings.get("magicLink") === "true");
    await store.load();
    expect(await magicLink()).toBe(true);

    tables.settings = [{ key: "magicLink", value: "false", updatedAt: "2026-01-01T00:00:01Z" }];
    vi.advanceTimersByTime(3_100);
    expect(await magicLink()).toBe(false);
    await store.load();
    expect(repository.list).toHaveBeenCalledTimes(1);
    expect(repository.listSettings).toHaveBeenCalledTimes(2);
  });

  it("detects a deleted row that was not the newest on another replica", async () => {
    const tables: FakeTables = {
      auth: [providerRow("google", "2026-01-01T00:00:00Z"), providerRow("github", "2026-01-01T00:00:05Z")],
      settings: [],
    };
    const replicaA = createConfigStore(fakeRepository(tables));
    const replicaB = createConfigStore(fakeRepository(tables));
    await replicaA.load();
    const before = await replicaB.currentVersion();
    expect((await replicaB.capabilitiesSnapshot()).providers).toEqual(["github", "google"]);

    tables.auth = tables.auth.filter((row) => row.key !== socialKey("google"));
    replicaA.invalidate();
    expect((await replicaA.capabilitiesSnapshot()).providers).toEqual(["github"]);
    expect(await replicaB.currentVersion()).toBe(before);

    vi.advanceTimersByTime(3_100);
    expect(await replicaB.currentVersion()).not.toBe(before);
    expect((await replicaB.capabilitiesSnapshot()).providers).toEqual(["github"]);
  });

  it("detects deletes without a probe by comparing the loaded rows", async () => {
    let rows = [providerRow("google", "2026-01-01T00:00:00Z"), providerRow("github", "2026-01-01T00:00:05Z")];
    const list = vi.fn(async (): Promise<readonly AuthConfigRow[]> => rows);
    const store = createConfigStore({ list });
    const before = await store.currentVersion();

    vi.advanceTimersByTime(3_100);
    expect(await store.currentVersion()).toBe(before);

    rows = rows.filter((row) => row.key !== socialKey("google"));
    vi.advanceTimersByTime(3_100);
    expect(await store.currentVersion()).not.toBe(before);
    expect((await store.load()).social.google).toBeUndefined();
    expect(list).toHaveBeenCalledTimes(3);
  });

  it("reloads every table after invalidate() even when the probe is unchanged", async () => {
    const tables: FakeTables = {
      auth: [{ key: "server", enabled: true, config: { allowDelete: false }, secret: null, updatedAt: "2026-01-01T00:00:00Z" }],
      settings: [],
    };
    const repository = fakeRepository(tables);
    const store = createConfigStore(repository);
    expect((await store.capabilitiesSnapshot()).allowDelete).toBe(false);

    // Same second-precision timestamp and row count, as SQLite can report.
    tables.auth = [{ key: "server", enabled: true, config: { allowDelete: true }, secret: null, updatedAt: "2026-01-01T00:00:00Z" }];
    store.invalidate();
    expect((await store.capabilitiesSnapshot()).allowDelete).toBe(true);
    expect(repository.list).toHaveBeenCalledTimes(2);
    expect(repository.listSettings).toHaveBeenCalledTimes(2);
  });

  it("keeps the version when a reload returns the same content", async () => {
    const tables: FakeTables = { auth: [providerRow("google", "2026-01-01T00:00:00Z")], settings: [] };
    const store = createConfigStore(fakeRepository(tables));
    const version = await store.currentVersion();
    store.invalidate();
    expect(await store.currentVersion()).toBe(version);
  });

  it("shares one refresh between concurrent readers", async () => {
    const tables: FakeTables = { auth: [], settings: [] };
    const repository = fakeRepository(tables);
    const store = createConfigStore(repository);
    await Promise.all([store.load(), store.capabilitiesSnapshot(), store.settings(), store.smtpConfig(), store.currentVersion()]);
    expect(repository.versions).toHaveBeenCalledTimes(1);
    expect(repository.list).toHaveBeenCalledTimes(1);
    expect(repository.listSettings).toHaveBeenCalledTimes(1);
  });

  it("discards a read that started before invalidate()", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let serverConfig: Record<string, unknown> = { auditLog: true };
    let calls = 0;
    const list = vi.fn(async (): Promise<readonly AuthConfigRow[]> => {
      calls += 1;
      const config = { ...serverConfig };
      if (calls === 1) await gate;
      return [{ key: "server", enabled: true, config, secret: null, updatedAt: "2026-01-01T00:00:00Z" }];
    });
    const store = createConfigStore({ list });
    const stale = store.capabilitiesSnapshot();
    serverConfig = { auditLog: false };
    store.invalidate();
    expect((await store.capabilitiesSnapshot()).auditLog).toBe(false);
    release();
    await stale;
    expect((await store.capabilitiesSnapshot()).auditLog).toBe(false);
  });

  it("fails open to the environment and setting defaults when the probe fails", async () => {
    const previous = process.env.AUDIT_LOG_ENABLED;
    process.env.AUDIT_LOG_ENABLED = "true";
    try {
      const tables: FakeTables = {
        auth: [{ key: "server", enabled: true, config: { auditLog: false }, secret: null, updatedAt: "2026-01-01T00:00:00Z" }],
        settings: [{ key: "site.allowSignup", value: "false" }],
      };
      const repository = fakeRepository(tables);
      const store = createConfigStore(repository);
      expect((await store.capabilitiesSnapshot()).auditLog).toBe(false);
      expect((await store.settings()).get("site.allowSignup")).toBe("false");

      repository.versions.mockRejectedValue(new Error('relation "auth_config" does not exist'));
      vi.advanceTimersByTime(3_100);
      expect(await store.currentVersion()).toBe("env");
      expect((await store.capabilitiesSnapshot()).auditLog).toBe(true);
      expect((await store.settings()).size).toBe(0);

      // A failed tick is retried after the TTL and reloads both tables.
      repository.versions.mockRestore();
      vi.advanceTimersByTime(3_100);
      expect((await store.capabilitiesSnapshot()).auditLog).toBe(false);
      expect((await store.settings()).get("site.allowSignup")).toBe("false");
    } finally {
      if (previous === undefined) delete process.env.AUDIT_LOG_ENABLED;
      else process.env.AUDIT_LOG_ENABLED = previous;
    }
  });

  it("falls back per table when a full read fails", async () => {
    const tables: FakeTables = { auth: [providerRow("google", "2026-01-01T00:00:00Z")], settings: [{ key: "magicLink", value: "false" }] };
    const repository = fakeRepository(tables);
    repository.list.mockRejectedValueOnce(new Error("blip"));
    repository.listSettings.mockRejectedValueOnce(new Error("blip"));
    const store = createConfigStore(repository);
    expect(await store.currentVersion()).toBe("env");
    expect((await store.settings()).size).toBe(0);

    vi.advanceTimersByTime(3_100);
    expect((await store.capabilitiesSnapshot()).providers).toEqual(["google"]);
    expect((await store.settings()).get("magicLink")).toBe("false");
  });

  it("probes through a query client before reading auth_config", async () => {
    const statements: string[] = [];
    const client: AuthConfigQueryClient = {
      query: async <Row extends Record<string, unknown>>(sql: string): Promise<{ rows: Row[] }> => {
        statements.push(sql);
        const rows = sql.includes("count(*)")
          ? [{ count: "1", updatedAt: "2026-01-01 00:00:00.123456+00" }]
          : [{ key: "server", enabled: true, config: { allowDelete: true }, secret: null, updatedAt: "2026-01-01T00:00:00Z" }];
        return { rows: rows as unknown as Row[] };
      },
    };
    const store = createConfigStore(client);
    expect((await store.capabilitiesSnapshot()).allowDelete).toBe(true);
    vi.advanceTimersByTime(3_100);
    await store.capabilitiesSnapshot();
    expect(statements.map((sql) => sql.includes("count(*)"))).toEqual([true, false, true]);
  });

  it("honours a custom TTL", async () => {
    const repository = fakeRepository({ auth: [], settings: [] });
    const store = createConfigStore(repository, { ttlMs: 500 });
    await store.smtpConfig();
    vi.advanceTimersByTime(600);
    await store.smtpConfig();
    expect(repository.versions).toHaveBeenCalledTimes(2);
  });
});
