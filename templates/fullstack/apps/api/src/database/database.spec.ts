import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AppEnv } from "../config/env.validation";
import { PROVIDERS } from "../config/providers";
import { databaseUrl, sqliteDatabasePath } from "./database";
import type { DatabaseProviderName } from "@podosoft/podokit-runtime";

const env: AppEnv = {
  NODE_ENV: "test",
  PORT: 5002,
  POSTGRES_HOST: "localhost",
  POSTGRES_PORT: 5432,
  POSTGRES_USER: "podokit",
  POSTGRES_PASSWORD: "podokit",
  POSTGRES_DB: "podokit",
};

function databaseProvider(): DatabaseProviderName {
  return PROVIDERS.database;
}

describe("database provider", () => {
  it("uses DATABASE_URL as the canonical connection setting", () => {
    const provider = databaseProvider();
    const DATABASE_URL = provider === "sqlite"
      ? "sqlite://:memory:"
      : "postgres://podokit:podokit@localhost:5432/podokit";
    expect(databaseUrl({ ...env, DATABASE_URL })).toBe(DATABASE_URL);
  });

  it("keeps the PostgreSQL fields as a fallback and creates a SQLite default", () => {
    const url = databaseUrl(env);
    const provider = databaseProvider();
    if (provider === "sqlite") expect(url).toMatch(/^sqlite:\/\//);
    else expect(url).toBe("postgres://podokit:podokit@localhost:5432/podokit");
  });

  it("rejects a connection URL for the other database dialect", () => {
    const provider = databaseProvider();
    const DATABASE_URL = provider === "sqlite"
      ? "postgres://podokit:podokit@localhost:5432/podokit"
      : "sqlite://:memory:";
    expect(() => databaseUrl({ ...env, DATABASE_URL })).toThrow("DATABASE_URL must use");
  });

  it("creates the parent directory for an explicit SQLite database", () => {
    const root = mkdtempSync(join(tmpdir(), "podokit-sqlite-"));
    try {
      const path = join(root, "nested", "app.sqlite");
      expect(sqliteDatabasePath(`sqlite://${path}`)).toBe(path);
      expect(existsSync(dirname(path))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
