export const DEMO_QUEUE = "demo";

export function redisConnection(): { host: string; port: number } {
  return {
    host: process.env.REDIS_HOST ?? "localhost",
    port: Number(process.env.REDIS_PORT ?? 6379),
  };
}
