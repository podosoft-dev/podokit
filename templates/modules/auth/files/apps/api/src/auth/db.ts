import { Database as SqliteDatabase } from "bun:sqlite";
import type { SQL } from "bun";
import { Pool } from "pg";
import type { AuthConfigRow } from "@podosoft/podokit-auth";
import type { DatabaseProviderName } from "@podosoft/podokit-runtime";
import { validateEnv } from "../config/env.validation";
import { PROVIDERS } from "../config/providers";
import { databaseUrl, sqliteDatabasePath } from "../database/database";

const env = validateEnv(process.env);
const url = databaseUrl(env);
function databaseProvider(): DatabaseProviderName {
  return PROVIDERS.database;
}
const provider = databaseProvider();

export const postgresPool = provider === "postgres"
  ? new Pool({ connectionString: url })
  : null;

export const sqliteDatabase = provider === "sqlite"
  ? new SqliteDatabase(sqliteDatabasePath(url), { create: true, strict: true })
  : null;

export const authDatabase = postgresPool ?? sqliteDatabase;
if (!authDatabase) throw new Error("No authentication database is configured");

let queryDatabase: SQL | undefined;

export function configureAuthQueryDatabase(sql: SQL): void {
  queryDatabase = sql;
}

function queries(): SQL {
  if (!queryDatabase) throw new Error("Authentication query database is not configured");
  return queryDatabase;
}

export async function readAppSettings(): Promise<Array<{ key: string; value: string }>> {
  const sql = queries();
  return sql<Array<{ key: string; value: string }>>`
    SELECT "key", "value" FROM "app_setting"
  `;
}

export async function readAuthConfig(): Promise<AuthConfigRow[]> {
  const sql = queries();
  const rows = await sql<Array<Omit<AuthConfigRow, "enabled"> & { enabled: boolean | number }>>`
    SELECT "key", "enabled", "config", "secret", "updatedAt" FROM "auth_config"
  `;
  return rows.map((row) => ({ ...row, enabled: row.enabled === true || row.enabled === 1 }));
}

export async function closeAuthDatabase(): Promise<void> {
  if (postgresPool) await postgresPool.end();
  sqliteDatabase?.close();
}
