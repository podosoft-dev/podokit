import "dotenv/config";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DataSource, type DataSourceOptions } from "typeorm";
import type { DatabaseProviderName } from "@podosoft/podokit-runtime";
import { PROVIDERS } from "../config/providers";
import { validateEnv } from "../config/env.validation";
import { databaseUrl, sqliteDatabasePath } from "./database";

const compiledMigrations = join(process.cwd(), "dist", "migrations");
const migrations = existsSync(compiledMigrations)
  ? [join(compiledMigrations, "[0-9]*.js")]
  : [join(process.cwd(), "src", "migrations", "[0-9]*.ts")];

const commonOptions = {
  entities: [],
  migrations,
  synchronize: false,
};

const env = validateEnv(process.env);
function databaseProvider(): DatabaseProviderName {
  return PROVIDERS.database;
}

export const dataSourceOptions: DataSourceOptions = databaseProvider() === "sqlite"
  ? {
      type: "better-sqlite3",
      database: sqliteDatabasePath(databaseUrl(env)),
      enableWAL: true,
      ...commonOptions,
    }
  : {
      type: "postgres",
      ...(process.env.DATABASE_URL ? { url: process.env.DATABASE_URL } : {}),
      host: env.POSTGRES_HOST,
      port: env.POSTGRES_PORT,
      username: env.POSTGRES_USER,
      password: env.POSTGRES_PASSWORD,
      database: env.POSTGRES_DB,
      ...commonOptions,
    };

// Used by the TypeORM CLI for migrations (see package.json scripts).
export const appDataSource = new DataSource(dataSourceOptions);
export default appDataSource;
