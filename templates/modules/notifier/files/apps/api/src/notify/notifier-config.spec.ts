import { describe, expect, test } from "bun:test";
import { encryptSecret } from "@podosoft/podokit-auth";
import {
  NOTIFY_KEYS,
  applyNotifierUpdate,
  describeNotifierConfig,
  envNotifierConfig,
  parseRecipients,
  resolveNotifierConfig,
  validateNotifierUpdate,
  type NotifyConfigRow,
} from "./notifier-config";

const ENV = {
  PUSHOVER_APP_TOKEN: "env-token",
  PUSHOVER_USER_KEY: "env-user",
  NOTIFY_EMAIL_TO: "ops@example.com, owner@example.com,ops@example.com",
  NOTIFY_WEBHOOK_URL: "https://example.com/hooks/env",
};

function pushoverRow(secrets: Record<string, string>, enabled = true): NotifyConfigRow {
  return { key: NOTIFY_KEYS.pushover, enabled, config: {}, secret: encryptSecret(JSON.stringify(secrets)) };
}

describe("notifier configuration", () => {
  test("uses the environment when no row is stored", () => {
    const config = envNotifierConfig(ENV);
    expect(config.pushover).toEqual({ enabled: true, token: "env-token", userKey: "env-user" });
    expect(config.email).toEqual({ enabled: true, recipients: ["ops@example.com", "owner@example.com"] });
    expect(config.webhook).toEqual({ enabled: true, url: "https://example.com/hooks/env" });
    expect(envNotifierConfig({}).pushover.enabled).toBe(false);
    expect(parseRecipients(" , ")).toEqual([]);
  });

  test("lets stored rows decide enabled and falls back field by field", () => {
    const config = resolveNotifierConfig([
      pushoverRow({ token: "db-token" }),
      { key: NOTIFY_KEYS.email, enabled: false, config: { recipients: ["db@example.com"] }, secret: null },
      { key: NOTIFY_KEYS.webhook, enabled: true, config: {}, secret: null },
    ], ENV);
    expect(config.pushover).toEqual({ enabled: true, token: "db-token", userKey: "env-user" });
    expect(config.email).toEqual({ enabled: false, recipients: ["db@example.com"] });
    expect(config.webhook.url).toBe("https://example.com/hooks/env");
  });

  test("reports an undecryptable secret and treats it as missing", () => {
    const failed: string[] = [];
    const config = resolveNotifierConfig(
      [{ key: NOTIFY_KEYS.webhook, enabled: true, config: {}, secret: "not|an|envelope" }],
      {},
      (key) => failed.push(key),
    );
    expect(config.webhook.url).toBe("");
    expect(failed).toEqual([NOTIFY_KEYS.webhook]);
  });

  test("never returns secrets from describe", () => {
    const view = describeNotifierConfig(resolveNotifierConfig([pushoverRow({ token: "db-token", userKey: "db-user" })], ENV));
    const text = JSON.stringify(view);
    for (const secret of ["db-token", "db-user", "env-token", "hooks/env"]) expect(text).not.toContain(secret);
    expect(view.pushover).toEqual({ enabled: true, hasToken: true, hasUserKey: true });
    expect(view.webhook).toEqual({ enabled: true, hasUrl: true });
  });

  test("encrypts new secrets, keeps blank ones, and removes null ones", () => {
    const seal = (plain: string): string => `sealed:${plain}`;
    const rows = [pushoverRow({ token: "old-token", userKey: "old-user" }, false)];
    const current = resolveNotifierConfig(rows, {});
    const [pushover, webhook] = applyNotifierUpdate(
      rows,
      { pushover: { token: "", userKey: "new-user" }, webhook: { enabled: true, url: "https://example.com/hook" } },
      current,
      seal,
    );
    expect(pushover?.enabled).toBe(false);
    expect(JSON.parse(pushover?.secret?.replace("sealed:", "") ?? "{}")).toEqual({ token: "old-token", userKey: "new-user" });
    expect(webhook).toEqual({ key: NOTIFY_KEYS.webhook, enabled: true, config: {}, secret: "sealed:https://example.com/hook" });

    const [cleared] = applyNotifierUpdate(rows, { pushover: { token: null, userKey: null } }, current, seal);
    expect(cleared?.secret).toBeNull();
  });

  test("starts a new row from the effective state and stores recipients", () => {
    const [email] = applyNotifierUpdate([], { email: { recipients: [" a@example.com ", "a@example.com"] } }, envNotifierConfig(ENV));
    expect(email).toEqual({ key: NOTIFY_KEYS.email, enabled: true, config: { recipients: ["a@example.com"] }, secret: null });
  });

  test("rejects invalid recipients and webhook URLs", () => {
    expect(() => validateNotifierUpdate({ email: { recipients: ["not-an-email"] } })).toThrow();
    expect(() => validateNotifierUpdate({ webhook: { url: "ftp://example.com" } })).toThrow();
    expect(() => validateNotifierUpdate({ webhook: { url: "javascript:alert(1)" } })).toThrow();
    expect(() => validateNotifierUpdate({ email: { recipients: Array.from({ length: 21 }, (_, i) => `u${i}@example.com`) } })).toThrow();
    expect(() => validateNotifierUpdate({ webhook: { url: "https://example.com/hook" }, email: { recipients: [] } })).not.toThrow();
  });
});
