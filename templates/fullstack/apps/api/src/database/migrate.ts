import { Database as SqliteDatabase } from "bun:sqlite";
import type { DatabaseProviderName } from "@podosoft/podokit-runtime";
import { validateEnv } from "../config/env.validation";
import { PROVIDERS } from "../config/providers";
import { databaseUrl, sqliteDatabasePath } from "./database";
import { revertLatestSqliteMigration, runSqliteMigrations } from "./sqlite-migrator";

function databaseProvider(): DatabaseProviderName {
  return PROVIDERS.database;
}

async function migrate(): Promise<void> {
  if (databaseProvider() === "sqlite") {
    const env = validateEnv(process.env);
    const database = new SqliteDatabase(sqliteDatabasePath(databaseUrl(env)), { create: true });
    try {
      if (process.argv.includes("--revert")) await revertLatestSqliteMigration(database);
      else await runSqliteMigrations(database);
    } finally {
      database.close();
    }
    return;
  }
  const { appDataSource: dataSource } = await import("./data-source.js");
  await dataSource.initialize();
  try {
    if (process.argv.includes("--revert")) await dataSource.undoLastMigration({ transaction: "all" });
    else await dataSource.runMigrations({ transaction: "all" });
  } finally {
    await dataSource.destroy();
  }
}

void migrate().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Migration failed: ${message}\n`);
  process.exitCode = 1;
});
