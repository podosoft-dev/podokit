import { describe, expect, it } from "bun:test";
import { validateEnv } from "../config/env.validation";
import { applyDevelopmentMigrations, type DevelopmentMigrationLog } from "./development-migrations";

interface Entry {
  level: "info" | "error";
  context: Record<string, unknown>;
  message: string;
}

function recorder(): { log: DevelopmentMigrationLog; entries: Entry[] } {
  const entries: Entry[] = [];
  return {
    entries,
    log: {
      info: (context, message) => entries.push({ level: "info", context, message }),
      error: (context, message) => entries.push({ level: "error", context, message }),
    },
  };
}

describe("development migrations", () => {
  it("reads PODOKIT_DEV_MIGRATE as a boolean that is off unless true", () => {
    expect(validateEnv({}).PODOKIT_DEV_MIGRATE).toBe(false);
    expect(validateEnv({ PODOKIT_DEV_MIGRATE: "" }).PODOKIT_DEV_MIGRATE).toBe(false);
    expect(validateEnv({ PODOKIT_DEV_MIGRATE: "false" }).PODOKIT_DEV_MIGRATE).toBe(false);
    expect(validateEnv({ PODOKIT_DEV_MIGRATE: "true" }).PODOKIT_DEV_MIGRATE).toBe(true);
    expect(() => validateEnv({ PODOKIT_DEV_MIGRATE: "yes" })).toThrow("PODOKIT_DEV_MIGRATE");
  });

  it("runs migrate:all before a development start that podo dev asked for", async () => {
    const { log, entries } = recorder();
    let runs = 0;
    const failure = await applyDevelopmentMigrations(
      { NODE_ENV: "development", PODOKIT_DEV_MIGRATE: true },
      log,
      async () => {
        runs += 1;
        return 0;
      },
    );
    expect(failure).toBeNull();
    expect(runs).toBe(1);
    expect(entries).toEqual([
      { level: "info", context: { durationMs: expect.any(Number) }, message: "Applied pending development migrations" },
    ]);
  });

  it("never runs without the flag or in production", async () => {
    const { log, entries } = recorder();
    const migrateAll = async (): Promise<number> => {
      throw new Error("must not run");
    };
    expect(await applyDevelopmentMigrations({ NODE_ENV: "development", PODOKIT_DEV_MIGRATE: false }, log, migrateAll)).toBeNull();
    expect(await applyDevelopmentMigrations({ NODE_ENV: "production", PODOKIT_DEV_MIGRATE: true }, log, migrateAll)).toBeNull();
    expect(entries).toEqual([]);
  });

  it("returns the reason and logs it when migrate:all fails, so the API still starts", async () => {
    const { log, entries } = recorder();
    const failure = await applyDevelopmentMigrations(
      { NODE_ENV: "development", PODOKIT_DEV_MIGRATE: true },
      log,
      async () => 1,
    );
    expect(failure).toContain("migrate:all exited with status 1");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ level: "error", context: { status: 1 } });
    expect(entries[0]?.message).toContain("Apply pending development migrations failed");
  });

  it("reports a launcher that cannot start as a failure", async () => {
    const { log, entries } = recorder();
    const failure = await applyDevelopmentMigrations(
      { NODE_ENV: "development", PODOKIT_DEV_MIGRATE: true },
      log,
      async () => {
        throw new Error("spawn failed");
      },
    );
    expect(failure).toContain("status -1");
    expect(entries.map((entry) => entry.message)).toEqual([
      "Start migrate:all failed",
      expect.stringContaining("Apply pending development migrations failed"),
    ]);
  });
});
