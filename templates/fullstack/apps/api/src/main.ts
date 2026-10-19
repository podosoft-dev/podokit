import { createApp } from "./app";
import { validateEnv } from "./config/env.validation";
import { serveApi } from "./core/serve";
import { createCoreServices, LOGGER, READINESS } from "./core/services";
import { applyDevelopmentMigrations } from "./database/development-migrations";
import { MIGRATIONS_READINESS_CHECK } from "./database/migration-readiness";

const env = validateEnv(process.env);
const services = createCoreServices(env);
const app = createApp({ env, services });

async function main(): Promise<void> {
  const migrationFailure = await applyDevelopmentMigrations(env, services.resolve(LOGGER));
  if (migrationFailure !== null) {
    services.resolve(READINESS).register(MIGRATIONS_READINESS_CHECK, async () => {
      throw new Error(migrationFailure);
    });
  }
  await serveApi(app, env, services);
}

void main();
