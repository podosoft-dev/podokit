import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DATABASE,
  LOCAL_PROVIDER_SELECTIONS,
  LocalObjectStore,
  MemoryCacheStore,
  MemoryEventBus,
  PROVIDER_CAPABILITIES,
  PROVIDER_NAMES,
  resolveProviderSelections,
  SERVER_PROVIDER_SELECTIONS,
} from "./index";

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "podokit-runtime-"));
  created.push(path);
  return path;
}

async function collect(body: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

describe("provider contracts", () => {
  it("defines complete server and local profiles with stable service keys", () => {
    expect(PROVIDER_CAPABILITIES).toEqual([
      "database",
      "cache",
      "object-storage",
      "events",
      "jobs",
    ]);
    expect(PROVIDER_NAMES.database).toEqual(["postgres", "sqlite"]);
    expect(SERVER_PROVIDER_SELECTIONS.database).toBe("postgres");
    expect(LOCAL_PROVIDER_SELECTIONS["object-storage"]).toBe("local");
    expect(DATABASE).toBe(Symbol.for("@podosoft/podokit/database"));
    expect(resolveProviderSelections({ cache: "memory" })).toEqual({
      ...SERVER_PROVIDER_SELECTIONS,
      cache: "memory",
    });
    expect(() => resolveProviderSelections({ database: "mysql" })).toThrow(
      "Unknown database provider",
    );
  });
});

describe("MemoryCacheStore", () => {
  it("expires TTL entries and evicts the least recently used value", async () => {
    let now = 1_000;
    const cache = new MemoryCacheStore({ maxEntries: 2, now: () => now });
    await cache.set("first", "1");
    await cache.set("second", "2", { ttlMs: 50 });
    await cache.get("first");
    await cache.set("third", "3");
    expect(await cache.get("second")).toBeNull();
    expect(await cache.get("first")).toBe("1");
    now = 2_000;
    await cache.set("short", "value", { ttlMs: 10 });
    now += 10;
    expect(await cache.get("short")).toBeNull();
  });

  it("returns fixed-window rate limit state", async () => {
    let now = 5_000;
    const cache = new MemoryCacheStore({ now: () => now });
    expect(await cache.incrementFixedWindow("user", { windowMs: 1_000, limit: 2 }))
      .toMatchObject({ allowed: true, count: 1, remaining: 1, resetAt: 6_000 });
    expect((await cache.incrementFixedWindow("user", { windowMs: 1_000, limit: 2 })).allowed)
      .toBe(true);
    expect((await cache.incrementFixedWindow("user", { windowMs: 1_000, limit: 2 })).allowed)
      .toBe(false);
    now = 6_000;
    expect((await cache.incrementFixedWindow("user", { windowMs: 1_000, limit: 2 })).count)
      .toBe(1);
  });
});

describe("MemoryEventBus", () => {
  it("isolates topics, clones JSON events, and unsubscribes", async () => {
    const bus = new MemoryEventBus();
    const received: unknown[] = [];
    const unsubscribe = await bus.subscribe("changes", (event) => received.push(event));
    const event = { id: 1 };
    await bus.publish("other", event);
    await bus.publish("changes", event);
    event.id = 2;
    await unsubscribe();
    await bus.publish("changes", event);
    expect(received).toEqual([{ id: 1 }]);
  });
});

describe("LocalObjectStore", () => {
  it("writes atomically, streams reads, and returns a stable local URL", async () => {
    const root = await temporaryDirectory();
    const store = new LocalObjectStore({ rootDirectory: root, publicBaseUrl: "/assets" });
    await expect(store.put("avatars/user one.txt", "hello", { contentType: "text/plain" }))
      .resolves.toMatchObject({ key: "avatars/user one.txt", size: 5 });
    const stored = await store.get("avatars/user one.txt");
    expect(await collect(stored.body)).toBe("hello");
    expect(stored.contentType).toBe("text/plain");
    expect(await store.getDownloadUrl("avatars/user one.txt")).toBe(
      "/assets/avatars/user%20one.txt",
    );
    expect(await readFile(join(root, "avatars/user one.txt"), "utf8")).toBe("hello");
    expect(await store.exists("avatars/user one.txt")).toBe(true);
    await store.delete("avatars/user one.txt");
    expect(await store.exists("avatars/user one.txt")).toBe(false);
  });

  it("rejects traversal, absolute paths, reserved paths, and symlink escapes", async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const store = new LocalObjectStore({ rootDirectory: root });
    await expect(store.put("../outside.txt", "no")).rejects.toThrow("safe relative path");
    await expect(store.put("/outside.txt", "no")).rejects.toThrow("safe relative path");
    await expect(store.put(".podokit/metadata/no", "no")).rejects.toThrow("reserved path");
    await mkdir(root, { recursive: true });
    await symlink(outside, join(root, "escape"), "dir");
    await expect(store.put("escape/no.txt", "no")).rejects.toThrow("symbolic link");
  });
});
