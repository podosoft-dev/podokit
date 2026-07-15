import { Injectable, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import {
  ThrottlerGuard,
  ThrottlerModule,
  type ThrottlerRequest,
} from "@nestjs/throttler";
import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import Redis from "ioredis";

const ttlSeconds = Number(process.env.RATE_LIMIT_TTL ?? 60);
const limit = Number(process.env.RATE_LIMIT_MAX ?? 100);
const runtimeLimit = Number(process.env.RATE_LIMIT_RUNTIME_MAX ?? 1000);
const unthrottledHealthPaths = new Set(["/health", "/health/ready"]);

function forwardedClient(headers: unknown): string | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const value = (headers as Record<string, unknown>)["x-forwarded-for"];
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first !== "string") return undefined;
  return first.split(",")[0]?.trim() || undefined;
}

// PodoKit exposes the API through its web proxy, which replaces x-forwarded-for
// with SvelteKit's resolved client address. Track that address instead of the
// web container so unrelated visitors do not share one global counter.
@Injectable()
class ProxyAwareThrottlerGuard extends ThrottlerGuard {
  protected override handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const { req } = this.getRequestResponse(requestProps.context);
    const method = typeof req.method === "string" ? req.method : "";
    const path = typeof req.path === "string" ? req.path : "";
    if (method === "GET" && unthrottledHealthPaths.has(path)) {
      return Promise.resolve(true);
    }
    if (method === "GET" && path === "/site/settings") {
      return super.handleRequest({ ...requestProps, limit: runtimeLimit });
    }
    return super.handleRequest(requestProps);
  }

  protected override getTracker(request: Record<string, unknown>): Promise<string> {
    const forwarded = forwardedClient(request.headers);
    const direct = typeof request.ip === "string" ? request.ip : "unknown";
    return Promise.resolve(forwarded ?? direct);
  }
}

// Distributed rate limiting: the counter lives in Redis, so the limit holds
// across API replicas. Registers a global guard (429 when exceeded).
@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: ttlSeconds * 1000, limit }],
      storage: new ThrottlerStorageRedisService(
        new Redis({
          host: process.env.REDIS_HOST ?? "localhost",
          port: Number(process.env.REDIS_PORT ?? 6379),
        }),
      ),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ProxyAwareThrottlerGuard }],
})
export class RateLimitModule {}
