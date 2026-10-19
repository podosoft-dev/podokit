import { validateEnv } from "./config/env.validation";
import { serveApi } from "./core/serve";
import { createCoreServices, LOGGER, READINESS } from "./core/services";
import { applyDevelopmentMigrations } from "./database/development-migrations";
import { MIGRATIONS_READINESS_CHECK } from "./database/migration-readiness";

const env = validateEnv(process.env);
const services = createCoreServices(env);

async function main(): Promise<void> {
  const migrationFailure = await applyDevelopmentMigrations(env, services.resolve(LOGGER));
  if (migrationFailure !== null) {
    services.resolve(READINESS).register(MIGRATIONS_READINESS_CHECK, async () => {
      throw new Error(migrationFailure);
    });
  }
  // Loaded after the migrations: the auth module checks its schema as it loads.
  const { createApp } = await import("./app.js");
  await serveApi(createApp({ env, services }), env, services);
}

void main();
