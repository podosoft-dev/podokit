import { join } from "node:path";
import type { AppEnv } from "../config/env.validation";

/** Runs `migrate:all` and resolves to its exit status. */
export type MigrateAll = () => Promise<number>;

const API_DIRECTORY = join(__dirname, "../..");

/** Runs the `migrate:all` launcher in the API directory, printing its output with the API's. */
export const runMigrateAll: MigrateAll = async () => {
  const child = Bun.spawn([process.execPath, join(API_DIRECTORY, "scripts/run-migrations.mjs")], {
    cwd: API_DIRECTORY,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
};

export interface DevelopmentMigrationLog {
  info(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

/**
 * Applies pending migrations before a development API starts when
 * PODOKIT_DEV_MIGRATE is true, which `podo dev` sets for the API container.
 * Compose Watch restarts that container whenever a file under apps/api/src
 * changes, so a migration that arrives with a pull or a rebase reaches the
 * development database before the API serves a request that needs it. A failed
 * run does not stop the API: it returns the reason, which the caller reports
 * as the `migrations` readiness check. Never runs in production, where the
 * deployment's migration step owns the schema.
 */
export async function applyDevelopmentMigrations(
  env: Pick<AppEnv, "NODE_ENV" | "PODOKIT_DEV_MIGRATE">,
  log: DevelopmentMigrationLog,
  migrateAll: MigrateAll = runMigrateAll,
): Promise<string | null> {
  if (!env.PODOKIT_DEV_MIGRATE || env.NODE_ENV === "production") return null;
  const started = performance.now();
  let status: number;
  try {
    status = await migrateAll();
  } catch (error) {
    status = -1;
    log.error({ err: error }, "Start migrate:all failed");
  }
  const durationMs = Math.round(performance.now() - started);
  if (status === 0) {
    log.info({ durationMs }, "Applied pending development migrations");
    return null;
  }
  const reason =
    `migrate:all exited with status ${status}; the database may lack migrations this code needs. ` +
    "Fix the error printed above, then restart the API (podo dev exec api bun run --cwd apps/api migrate:all to retry by hand)";
  log.error({ status, durationMs }, `Apply pending development migrations failed: ${reason}`);
  return reason;
}
