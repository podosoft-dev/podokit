import type { RedisClient } from "bun";
import type {
  CacheSetOptions,
  CacheStore,
  FixedWindowOptions,
  FixedWindowResult,
} from "@podosoft/podokit-runtime";
import type { RedisService } from "./redis.service";

const FIXED_WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return { count, ttl }
`;

function resultNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export class RedisCacheStore implements CacheStore {
  private readonly client: RedisClient;

  constructor(private readonly redis: RedisService) {
    this.client = redis.client;
  }

  get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, options: CacheSetOptions = {}): Promise<void> {
    await this.client.set(key, value);
    if (options.ttlMs !== undefined) {
      if (!Number.isSafeInteger(options.ttlMs) || options.ttlMs < 1) {
        throw new Error("ttlMs must be a positive integer");
      }
      await this.client.send("PEXPIRE", [key, String(options.ttlMs)]);
    }
  }

  async delete(key: string): Promise<boolean> {
    return (await this.redis.del(key)) > 0;
  }

  async incrementFixedWindow(
    key: string,
    options: FixedWindowOptions,
  ): Promise<FixedWindowResult> {
    if (!Number.isSafeInteger(options.windowMs) || options.windowMs < 1) {
      throw new Error("windowMs must be a positive integer");
    }
    if (!Number.isSafeInteger(options.limit) || options.limit < 1) {
      throw new Error("limit must be a positive integer");
    }
    const result = await this.client.send("EVAL", [
      FIXED_WINDOW_SCRIPT,
      "1",
      key,
      String(options.windowMs),
    ]);
    if (!Array.isArray(result)) throw new Error("Redis returned an invalid cache counter");
    const count = resultNumber(result[0]);
    const ttlMs = resultNumber(result[1]);
    if (count === undefined || ttlMs === undefined) {
      throw new Error("Redis returned an invalid cache counter");
    }
    return {
      allowed: count <= options.limit,
      count,
      remaining: Math.max(0, options.limit - count),
      resetAt: Date.now() + Math.max(1, ttlMs),
    };
  }

  close(): void {}
}
