import { getMigrations } from "better-auth/db/migration";
import { auth } from "./auth/auth";
import { closeAuthDatabase, postgresPool, sqliteDatabase } from "./auth/db";
import {
  migrateLegacyAccountIssuers,
  postgresAccountIssuerMigrationDatabase,
} from "./auth/account-issuer-migration";
import { runSqliteMigrations } from "./database/sqlite-migrator";

async function runMigrations(): Promise<void> {
  if (postgresPool) {
    await migrateLegacyAccountIssuers(postgresAccountIssuerMigrationDatabase(postgresPool));
  }

  const authMigrations = await getMigrations(auth.options);
  await authMigrations.runMigrations();

  if (sqliteDatabase) {
    await runSqliteMigrations(sqliteDatabase);
  } else {
    const { appDataSource: dataSource } = await import("./database/data-source.js");
    await dataSource.initialize();
    try {
      await dataSource.runMigrations();
    } finally {
      await dataSource.destroy();
    }
  }
}

runMigrations()
  .catch((error: unknown) => {
    console.error("Run database migrations failed", error);
    process.exitCode = 1;
  })
  .finally(async (): Promise<void> => {
    await closeAuthDatabase();
  });
