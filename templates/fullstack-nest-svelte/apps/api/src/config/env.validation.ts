// Minimal typed environment validation. Extend as the app grows.
export interface AppEnv {
  nodeEnv: string;
  port: number;
  corsOrigin: string | undefined;
}

export function validateEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
  const port = Number(env.PORT ?? 3000);
  if (Number.isNaN(port)) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
  }
  return {
    nodeEnv: env.NODE_ENV ?? "development",
    port,
    corsOrigin: env.CORS_ORIGIN,
  };
}
