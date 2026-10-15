import type { RedisClient } from "bun";
import { describe, expect, it } from "bun:test";
import { RedisService } from "./redis.service";

type Listener = (message: string, channel: string) => void;

/** One Redis server shared by fake clients: it can go down, and it drops every connection when it does. */
class FakeRedis {
  up = true;
  readonly clients: FakeClient[] = [];

  client(): RedisClient {
    const client = new FakeClient(this);
    this.clients.push(client);
    return client as unknown as RedisClient;
  }

  stop(): void {
    this.up = false;
    for (const client of this.clients) client.drop();
  }

  publish(channel: string, message: string): number {
    let receivers = 0;
    for (const client of this.clients) {
      if (!client.connected || !client.channels.has(channel)) continue;
      receivers += 1;
      client.listener?.(message, channel);
    }
    return receivers;
  }
}

class FakeClient {
  connected = false;
  onclose: ((error: Error) => void) | null = null;
  readonly channels = new Set<string>();
  listener?: Listener;

  constructor(private readonly server: FakeRedis) {}

  connect(): Promise<void> {
    if (!this.server.up) {
      this.onclose?.(new Error("Connection closed"));
      return Promise.reject(new Error("Connection closed"));
    }
    this.connected = true;
    return Promise.resolve();
  }

  ping(): Promise<string> {
    return this.connected ? Promise.resolve("PONG") : Promise.reject(new Error("Connection closed"));
  }

  subscribe(channels: string | string[], listener: Listener): Promise<number> {
    if (!this.connected) return Promise.reject(new Error("Connection closed"));
    for (const channel of [channels].flat()) this.channels.add(channel);
    this.listener = listener;
    return Promise.resolve(this.channels.size);
  }

  unsubscribe(channel: string): Promise<void> {
    this.channels.delete(channel);
    return Promise.resolve();
  }

  drop(): void {
    if (!this.connected) return;
    // Bun forgets the server subscription but keeps its listener.
    this.connected = false;
    this.channels.clear();
    this.onclose?.(new Error("Connection closed"));
  }

  close(): void {
    if (!this.connected) return;
    this.connected = false;
    this.onclose?.(new Error("Connection closed"));
  }
}

describe("RedisService subscriptions", () => {
  it("subscribes once Redis becomes reachable after starting without it", async () => {
    const server = new FakeRedis();
    server.up = false;
    const service = new RedisService(() => server.client());
    const received: string[] = [];
    await service.subscribe("orders", (message) => { received.push(message); });

    await expect(service.connect()).rejects.toThrow("Connection closed");
    server.up = true;
    await service.connect();

    expect(server.publish("orders", "created")).toBe(1);
    expect(received).toEqual(["created"]);
    service.close();
  });

  it("reports a dropped connection and restores every subscription on reconnect", async () => {
    const server = new FakeRedis();
    const service = new RedisService(() => server.client());
    const lost: unknown[] = [];
    service.onLost((reason) => { lost.push(reason); });
    await service.connect();
    const received: string[] = [];
    await service.subscribe("orders", (message) => { received.push(`orders:${message}`); });
    await service.subscribe("users", (message) => { received.push(`users:${message}`); });

    server.stop();
    expect(lost.length).toBeGreaterThan(0);
    await expect(service.connect()).rejects.toThrow("Connection closed");
    server.up = true;
    await service.connect();

    expect(server.publish("orders", "1")).toBe(1);
    expect(server.publish("users", "2")).toBe(1);
    expect(received).toEqual(["orders:1", "users:2"]);
    service.close();
  });

  it("stops delivering after the last handler of a channel unsubscribes", async () => {
    const server = new FakeRedis();
    const service = new RedisService(() => server.client());
    await service.connect();
    const received: string[] = [];
    const unsubscribe = await service.subscribe("orders", (message) => { received.push(message); });

    await unsubscribe();
    expect(server.publish("orders", "late")).toBe(0);
    expect(received).toEqual([]);
    service.close();
  });

  it("does not report connections it closes itself", async () => {
    const server = new FakeRedis();
    const service = new RedisService(() => server.client());
    const lost: unknown[] = [];
    service.onLost((reason) => { lost.push(reason); });
    await service.connect();

    service.close();
    expect(lost).toEqual([]);
  });
});

const redisUrl = process.env.REDIS_TEST_URL;
const integrationTest = redisUrl ? it : it.skip;

describe("RedisService integration", () => {
  integrationTest("uses authenticated settings and answers pings", async () => {
    const previousUrl = process.env.REDIS_URL;
    process.env.REDIS_URL = redisUrl;
    const service = new RedisService();
    const key = `podokit:test:${Date.now()}:${Math.random().toString(36).slice(2)}`;

    try {
      await service.connect();
      await service.set(key, "value", 10);
      await expect(service.get(key)).resolves.toBe("value");
      await expect(service.ping()).resolves.toBeUndefined();
      await service.del(key);
    } finally {
      service.close();
      if (previousUrl === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = previousUrl;
    }
  });

  integrationTest("delivers a published message to a subscriber", async () => {
    const previousUrl = process.env.REDIS_URL;
    process.env.REDIS_URL = redisUrl;
    const service = new RedisService();
    const channel = `podokit:test:${Date.now()}:${Math.random().toString(36).slice(2)}`;

    try {
      await service.connect();
      const received = new Promise<string>((resolve) => {
        void service.subscribe(channel, resolve);
      });
      await Bun.sleep(50);
      await service.publish(channel, "hello");
      await expect(received).resolves.toBe("hello");
    } finally {
      service.close();
      if (previousUrl === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = previousUrl;
    }
  });
});
