import type { RedisClient } from "bun";
import { describe, expect, it } from "bun:test";
import { RedisEventBus } from "./redis-event.bus";

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

  deliver(channel: string, message: string): number {
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

  publish(channel: string, message: string): Promise<number> {
    if (!this.connected) {
      return Promise.reject(new Error("Connection is closed and offline queue is disabled"));
    }
    return Promise.resolve(this.server.deliver(channel, message));
  }

  subscribe(channel: string, listener: Listener): Promise<number> {
    if (!this.connected) return Promise.reject(new Error("Connection closed"));
    this.channels.add(channel);
    this.listener = listener;
    return Promise.resolve(this.channels.size);
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

function bus(server: FakeRedis): RedisEventBus {
  return new RedisEventBus({ EVENTS_REDIS_CHANNEL: "test:events" }, () => server.client());
}

describe("RedisEventBus reconnects", () => {
  it("keeps handlers registered without Redis and delivers once the channel is subscribed", async () => {
    const server = new FakeRedis();
    server.up = false;
    const events = bus(server);
    let interruptions = 0;
    events.onInterruption(() => { interruptions += 1; });
    const received: unknown[] = [];
    await events.subscribe("sse", (event) => { received.push(event); });

    await expect(events.connect()).rejects.toThrow("Connection closed");
    await expect(events.ready()).rejects.toThrow("not subscribed");
    server.up = true;
    await events.connect();
    await events.ready();

    await events.publish("sse", { id: 1 });
    expect(received).toEqual([{ id: 1 }]);
    // Streams opened before the first subscription may have missed events.
    expect(interruptions).toBe(1);
    events.close();
  });

  it("subscribes again after Redis drops the connections and reports one interruption", async () => {
    const server = new FakeRedis();
    const events = bus(server);
    const lost: unknown[] = [];
    events.onLost((reason) => { lost.push(reason); });
    let interruptions = 0;
    events.onInterruption(() => { interruptions += 1; });
    const received: unknown[] = [];
    await events.subscribe("config.changed", (event) => { received.push(event); });
    await events.connect();
    expect(interruptions).toBe(0);

    server.stop();
    expect(lost.length).toBeGreaterThan(0);
    await expect(events.ready()).rejects.toThrow("not subscribed");
    await expect(events.publish("config.changed", { origin: "a" })).rejects.toThrow("offline queue");
    server.up = true;
    await events.connect();

    expect(interruptions).toBe(1);
    await events.publish("config.changed", { origin: "b" });
    expect(received).toEqual([{ origin: "b" }]);
    events.close();
  });

  it("reports no interruption when only the publisher reconnects", async () => {
    const server = new FakeRedis();
    const events = bus(server);
    let interruptions = 0;
    events.onInterruption(() => { interruptions += 1; });
    await events.connect();

    server.clients[0]?.drop();
    await events.connect();
    expect(interruptions).toBe(0);
    await events.ready();
    events.close();
  });

  it("does not report connections it closes itself", async () => {
    const server = new FakeRedis();
    const events = bus(server);
    const lost: unknown[] = [];
    events.onLost((reason) => { lost.push(reason); });
    await events.connect();

    events.close();
    expect(lost).toEqual([]);
  });
});
