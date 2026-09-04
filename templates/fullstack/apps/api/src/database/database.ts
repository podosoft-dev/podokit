import { SQL } from "bun";
import type { DatabaseProviderName } from "@podosoft/podokit-runtime";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AppEnv } from "../config/env.validation";
import { PROVIDERS } from "../config/providers";

function isSqliteUrl(url: string): boolean {
  return url === ":memory:" || /^(?:sqlite|file):/.test(url);
}

function selectedDatabaseProvider(): DatabaseProviderName {
  return PROVIDERS.database;
}

export function databaseUrl(env: AppEnv): string {
  const provider = selectedDatabaseProvider();
  if (env.DATABASE_URL) {
    if (provider === "sqlite" && !isSqliteUrl(env.DATABASE_URL)) {
      throw new Error("DATABASE_URL must use sqlite:, file:, or :memory: for the SQLite provider");
    }
    if (provider === "postgres" && isSqliteUrl(env.DATABASE_URL)) {
      throw new Error("DATABASE_URL must use postgres: for the PostgreSQL provider");
    }
    return env.DATABASE_URL;
  }
  if (provider === "sqlite") {
    const path = resolve("./data/podokit.sqlite");
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    return `sqlite://${path}`;
  }
  const username = encodeURIComponent(env.POSTGRES_USER);
  const password = encodeURIComponent(env.POSTGRES_PASSWORD);
  const database = encodeURIComponent(env.POSTGRES_DB);
  return `postgres://${username}:${password}@${env.POSTGRES_HOST}:${env.POSTGRES_PORT}/${database}`;
}

export function sqliteDatabasePath(url: string): string {
  if (url === ":memory:" || url === "sqlite://:memory:") return ":memory:";
  const path = url.startsWith("sqlite://")
    ? url.slice("sqlite://".length)
    : url.startsWith("file:")
      ? decodeURIComponent(new URL(url).pathname)
      : undefined;
  if (!path) throw new Error("SQLite database URL must use sqlite:, file:, or :memory:");
  mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  return path;
}

export class Database {
  readonly provider: DatabaseProviderName = selectedDatabaseProvider();
  readonly sql: SQL;
  private ready?: Promise<void>;

  constructor(env: AppEnv) {
    const url = databaseUrl(env);
    this.sql = this.provider === "sqlite"
      ? new SQL(url, { adapter: "sqlite", create: true, readwrite: true, strict: true })
      : new SQL(url, { max: 20 });
  }

  connect(): Promise<void> {
    this.ready ??= (async () => {
      if (this.provider === "sqlite") {
        await this.sql`PRAGMA journal_mode = WAL`;
        await this.sql`PRAGMA foreign_keys = ON`;
        await this.sql`PRAGMA busy_timeout = 5000`;
      }
      await this.sql`SELECT 1`;
    })();
    return this.ready;
  }

  async ping(): Promise<void> {
    await this.connect();
  }

  async close(): Promise<void> {
    await this.sql.close();
  }
}
