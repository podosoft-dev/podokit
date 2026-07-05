import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import Redis from "ioredis";

const ttlSeconds = Number(process.env.RATE_LIMIT_TTL ?? 60);
const limit = Number(process.env.RATE_LIMIT_MAX ?? 100);

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
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class RateLimitModule {}
