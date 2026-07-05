import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client = new Redis({
    host: process.env.REDIS_HOST ?? "localhost",
    port: Number(process.env.REDIS_PORT ?? 6379),
    maxRetriesPerRequest: null,
  });
  private readonly subscribers: Redis[] = [];

  get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) await this.client.set(key, value, "EX", ttlSeconds);
    else await this.client.set(key, value);
  }

  del(key: string): Promise<number> {
    return this.client.del(key);
  }

  publish(channel: string, message: string): Promise<number> {
    return this.client.publish(channel, message);
  }

  // Subscribe on a dedicated connection (ioredis can't mix subscribe + commands).
  subscribe(channel: string, handler: (message: string) => void): void {
    const sub = this.client.duplicate();
    this.subscribers.push(sub);
    void sub.subscribe(channel);
    sub.on("message", (ch, message) => {
      if (ch === channel) handler(message);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.client.quit(), ...this.subscribers.map((s) => s.quit())]);
  }
}
