import { mkdtemp, mkdir, readdir, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertPartNumber,
  DATABASE,
  LOCAL_PROVIDER_SELECTIONS,
  LocalObjectStore,
  MAX_MULTIPART_PARTS,
  MemoryCacheStore,
  MemoryEventBus,
  MIN_MULTIPART_PART_BYTES,
  MultipartUploadError,
  normalizeCompletedParts,
  objectBodyChunks,
  objectNotModified,
  objectResponse,
  type ObjectData,
  PROVIDER_CAPABILITIES,
  PROVIDER_NAMES,
  readObjectBytes,
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

async function collect(body: ReadableStream<Uint8Array>): Promise<string> {
  return Buffer.from(await new Response(body).arrayBuffer()).toString("utf8");
}

async function listAll(store: LocalObjectStore, prefix: string, limit: number): Promise<string[][]> {
  const pages: string[][] = [];
  let cursor: string | undefined;
  do {
    const page = await store.list(prefix, { limit, ...(cursor === undefined ? {} : { cursor }) });
    pages.push(page.keys);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return pages;
}

interface FakeObject {
  object: ObjectData;
  /** Whether a consumer pulled from or cancelled the body. */
  touched: () => "pulled" | "cancelled" | "untouched";
}

function fakeObject(content: string): FakeObject {
  let state: "pulled" | "cancelled" | "untouched" = "untouched";
  const bytes = Buffer.from(content);
  return {
    object: {
      key: "files/a.txt",
      size: bytes.byteLength,
      contentType: "text/plain",
      etag: '"v1"',
      lastModified: new Date("2026-01-02T03:04:05.678Z"),
      body: new ReadableStream<Uint8Array>({
        pull(controller): void {
          state = "pulled";
          controller.enqueue(bytes);
          controller.close();
        },
        cancel(): void {
          state = "cancelled";
        },
      }, { highWaterMark: 0 }),
    },
    touched: () => state,
  };
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
    if (!stored) throw new Error("expected the stored object");
    expect(await collect(stored.body)).toBe("hello");
    expect(stored).toMatchObject({ key: "avatars/user one.txt", size: 5, contentType: "text/plain" });
    expect(stored.etag).toMatch(/^"[0-9a-f]+-5-[0-9a-f]+"$/);
    expect(stored.lastModified).toBeInstanceOf(Date);
    expect(await store.getDownloadUrl("avatars/user one.txt")).toBe(
      "/assets/avatars/user%20one.txt",
    );
    expect(await readFile(join(root, "avatars/user one.txt"), "utf8")).toBe("hello");
    expect(await store.exists("avatars/user one.txt")).toBe(true);
    await store.delete("avatars/user one.txt");
    expect(await store.exists("avatars/user one.txt")).toBe(false);
  });

  it("prepares the root on first use and retries a failed attempt", async () => {
    const parent = await temporaryDirectory();
    const root = join(parent, "objects");
    await writeFile(root, "not a directory");
    const store = new LocalObjectStore({ rootDirectory: root });
    await expect(store.put("a.txt", "a")).rejects.toThrow();
    await rm(root);
    await expect(store.put("a.txt", "a")).resolves.toMatchObject({ key: "a.txt", size: 1 });

    const unused = join(parent, "unused");
    new LocalObjectStore({ rootDirectory: unused });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(readFile(unused)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports missing objects, directories, and symbolic links as null", async () => {
    const root = await temporaryDirectory();
    const store = new LocalObjectStore({ rootDirectory: root });
    await store.put("folder/file.txt", "x");
    await symlink(join(root, "folder", "file.txt"), join(root, "link.txt"));

    for (const key of ["missing.txt", "folder", "folder/file.txt/below", "link.txt"]) {
      expect(await store.get(key)).toBeNull();
      expect(await store.stat(key)).toBeNull();
      expect(await store.exists(key)).toBe(false);
    }
  });

  it("describes an object without opening it and changes the tag on every write", async () => {
    const root = await temporaryDirectory();
    const store = new LocalObjectStore({ rootDirectory: root });
    await store.put("a.txt", "first", { contentType: "text/plain" });
    const first = await store.stat("a.txt");
    const unread = await store.get("a.txt");
    if (!first || !unread) throw new Error("expected the stored object");
    await unread.body.cancel();

    await store.put("a.txt", "other", { contentType: "text/plain" });
    const second = await store.stat("a.txt");

    expect(second).toMatchObject({ key: "a.txt", size: 5, contentType: "text/plain" });
    expect(second?.etag).not.toBe(first.etag);
  });

  it("streams in bounded chunks and refuses a file replaced after the read began", async () => {
    const root = await temporaryDirectory();
    const store = new LocalObjectStore({ rootDirectory: root });
    const content = Buffer.alloc(200 * 1024, 7);
    await store.put("large.bin", content);
    const object = await store.get("large.bin");
    if (!object) throw new Error("expected the stored object");
    const sizes: number[] = [];
    const reader = object.body.getReader();
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      sizes.push(next.value.byteLength);
    }
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(content.byteLength);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(64 * 1024);

    const stale = await store.get("large.bin");
    if (!stale) throw new Error("expected the stored object");
    await store.put("large.bin", "replaced");
    await expect(collect(stale.body)).rejects.toThrow("changed while it was being read");
  });

  it("lists keys in pages without leaking reserved or temporary files", async () => {
    const root = await temporaryDirectory();
    const store = new LocalObjectStore({ rootDirectory: root });
    for (const key of ["a/b.txt", "a.txt", "a/c/d.txt", "a0.txt", "b.txt", "a/b-2.txt"]) {
      await store.put(key, key, { contentType: "text/plain" });
    }
    await writeFile(join(root, "a", ".podokit-abc.tmp"), "partial");

    expect(await store.list("")).toEqual({
      keys: ["a.txt", "a/b-2.txt", "a/b.txt", "a/c/d.txt", "a0.txt", "b.txt"],
    });
    expect(await listAll(store, "", 2)).toEqual([
      ["a.txt", "a/b-2.txt"],
      ["a/b.txt", "a/c/d.txt"],
      ["a0.txt", "b.txt"],
    ]);
    expect((await listAll(store, "a/", 1)).flat()).toEqual(["a/b-2.txt", "a/b.txt", "a/c/d.txt"]);
    expect((await store.list("a/b")).keys).toEqual(["a/b-2.txt", "a/b.txt"]);
    expect((await store.list("a")).keys).toEqual(["a.txt", "a/b-2.txt", "a/b.txt", "a/c/d.txt", "a0.txt"]);
    expect(await store.list("missing/")).toEqual({ keys: [] });
    expect(await store.list("a.txt/")).toEqual({ keys: [] });
    expect(await store.list(".podokit/")).toEqual({ keys: [] });
  });

  it("rejects unsafe list prefixes and page sizes", async () => {
    const store = new LocalObjectStore({ rootDirectory: await temporaryDirectory() });
    await expect(store.list("../")).rejects.toThrow("safe relative path");
    await expect(store.list("/etc/")).rejects.toThrow("safe relative path");
    await expect(store.list("a//b")).rejects.toThrow("safe relative path");
    await expect(store.list("", { limit: 0 })).rejects.toThrow("from 1 to 1000");
    await expect(store.list("", { limit: 1001 })).rejects.toThrow("from 1 to 1000");
    await expect(store.list("", { limit: 1.5 })).rejects.toThrow("from 1 to 1000");
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

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller): void {
      for (const chunk of chunks) controller.enqueue(Buffer.from(chunk));
      controller.close();
    },
  });
}

async function* iterableOf(...chunks: string[]): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) yield Buffer.from(chunk);
}

function multipartError(code: string): unknown {
  return expect.objectContaining({ name: "MultipartUploadError", code });
}

describe("object bodies", () => {
  it("stores strings, bytes, blobs, streams, and async iterables", async () => {
    const store = new LocalObjectStore({ rootDirectory: await temporaryDirectory() });
    const bodies = {
      "string.txt": "héllo",
      "bytes.txt": Buffer.from("bytes"),
      "blob.txt": new Blob(["bl", "ob"]),
      "stream.txt": streamOf("str", "eam"),
      "iterable.txt": iterableOf("iter", "able"),
    };
    for (const [key, body] of Object.entries(bodies)) await store.put(key, body);

    const contents: Record<string, string> = {};
    for (const key of Object.keys(bodies)) {
      const object = await store.get(key);
      if (!object) throw new Error(`expected ${key}`);
      contents[key] = await collect(object.body);
    }
    expect(contents).toEqual({
      "string.txt": "héllo",
      "bytes.txt": "bytes",
      "blob.txt": "blob",
      "stream.txt": "stream",
      "iterable.txt": "iterable",
    });
    expect(await store.stat("string.txt")).toMatchObject({ size: Buffer.byteLength("héllo") });
  });

  it("releases a stream that is not read to the end", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller): void {
        controller.enqueue(new Uint8Array(4));
      },
      cancel(): void {
        cancelled = true;
      },
    });
    for await (const chunk of objectBodyChunks(body)) {
      expect(chunk.byteLength).toBe(4);
      break;
    }
    expect(cancelled).toBe(true);
  });

  it("removes the partial file when a streamed body fails", async () => {
    const root = await temporaryDirectory();
    const store = new LocalObjectStore({ rootDirectory: root });
    async function* failing(): AsyncGenerator<Uint8Array> {
      yield Buffer.from("partial");
      throw new Error("client went away");
    }
    await expect(store.put("dir/failed.txt", failing())).rejects.toThrow("client went away");
    expect(await store.exists("dir/failed.txt")).toBe(false);
    expect(await readdir(join(root, "dir"))).toEqual([]);
  });
});

describe("multipart helpers", () => {
  it("validates part numbers and orders completed parts", () => {
    expect(MIN_MULTIPART_PART_BYTES).toBe(5 * 1024 * 1024);
    expect(MAX_MULTIPART_PARTS).toBe(10_000);
    for (const partNumber of [0, -1, 1.5, MAX_MULTIPART_PARTS + 1, Number.NaN]) {
      expect(() => assertPartNumber(partNumber)).toThrow(RangeError);
    }
    expect(() => assertPartNumber(MAX_MULTIPART_PARTS)).not.toThrow();

    expect(normalizeCompletedParts([
      { partNumber: 3, etag: "c" },
      { partNumber: 1, etag: "a" },
    ])).toEqual([{ partNumber: 1, etag: "a" }, { partNumber: 3, etag: "c" }]);
    expect(() => normalizeCompletedParts([])).toThrow("at least one part");
    expect(() => normalizeCompletedParts([{ partNumber: 1, etag: "a" }, { partNumber: 1, etag: "b" }]))
      .toThrow("more than once");
    expect(() => normalizeCompletedParts([{ partNumber: 1, etag: "" }])).toThrow(TypeError);
    expect(() => normalizeCompletedParts([{ partNumber: 0, etag: "a" }])).toThrow(RangeError);
  });
});

describe("LocalObjectStore multipart uploads", () => {
  const part = (fill: number, size = MIN_MULTIPART_PART_BYTES): Uint8Array => new Uint8Array(size).fill(fill);

  it("joins parts uploaded out of order, in part-number order", async () => {
    const root = await temporaryDirectory();
    const store = new LocalObjectStore({ rootDirectory: root });
    const { uploadId } = await store.createMultipartUpload("videos/clip.bin", {
      contentType: "application/octet-stream",
    });
    expect(await store.exists("videos/clip.bin")).toBe(false);

    const third = await store.uploadPart("videos/clip.bin", uploadId, 3, streamOf("tail"));
    const first = await store.uploadPart("videos/clip.bin", uploadId, 1, new Blob([part(1)]));
    const second = await store.uploadPart("videos/clip.bin", uploadId, 2, part(2));
    expect(first.size).toBe(MIN_MULTIPART_PART_BYTES);
    expect(third).toMatchObject({ size: 4 });

    const info = await store.completeMultipartUpload("videos/clip.bin", uploadId, [
      { partNumber: 3, etag: third.etag },
      { partNumber: 1, etag: first.etag },
      { partNumber: 2, etag: second.etag },
    ]);
    expect(info).toMatchObject({
      key: "videos/clip.bin",
      size: 2 * MIN_MULTIPART_PART_BYTES + 4,
      contentType: "application/octet-stream",
    });
    expect(await store.stat("videos/clip.bin")).toEqual(info);

    const content = await readFile(join(root, "videos", "clip.bin"));
    expect(content.byteLength).toBe(info.size);
    expect(content[0]).toBe(1);
    expect(content[MIN_MULTIPART_PART_BYTES]).toBe(2);
    expect(content.subarray(-4).toString("utf8")).toBe("tail");
    expect(await readdir(join(root, ".podokit", "multipart"))).toEqual([]);
    expect(await readdir(join(root, "videos"))).toEqual(["clip.bin"]);
    await expect(store.uploadPart("videos/clip.bin", uploadId, 1, "late"))
      .rejects.toEqual(multipartError("UPLOAD_NOT_FOUND"));
  });

  it("replaces a part uploaded again and refuses the replaced etag", async () => {
    const store = new LocalObjectStore({ rootDirectory: await temporaryDirectory() });
    const { uploadId } = await store.createMultipartUpload("a.txt");
    const before = await store.uploadPart("a.txt", uploadId, 1, "first");
    const after = await store.uploadPart("a.txt", uploadId, 1, "second");
    expect(after.etag).not.toBe(before.etag);

    await expect(store.completeMultipartUpload("a.txt", uploadId, [{ partNumber: 1, etag: before.etag }]))
      .rejects.toEqual(multipartError("INVALID_PART"));
    await expect(store.completeMultipartUpload("a.txt", uploadId, [{ partNumber: 2, etag: after.etag }]))
      .rejects.toEqual(multipartError("INVALID_PART"));
    await store.completeMultipartUpload("a.txt", uploadId, [{ partNumber: 1, etag: after.etag }]);
    const object = await store.get("a.txt");
    expect(object && await collect(object.body)).toBe("second");
  });

  it("requires every part but the last to meet the minimum size", async () => {
    const store = new LocalObjectStore({ rootDirectory: await temporaryDirectory() });
    const { uploadId } = await store.createMultipartUpload("small.bin");
    const first = await store.uploadPart("small.bin", uploadId, 1, "small");
    const second = await store.uploadPart("small.bin", uploadId, 2, "last");
    await expect(store.completeMultipartUpload("small.bin", uploadId, [
      { partNumber: 1, etag: first.etag },
      { partNumber: 2, etag: second.etag },
    ])).rejects.toEqual(multipartError("PART_TOO_SMALL"));
    // The failed attempt leaves the upload in place.
    await expect(store.completeMultipartUpload("small.bin", uploadId, [{ partNumber: 1, etag: first.etag }]))
      .resolves.toMatchObject({ size: 5 });
  });

  it("refuses unknown, malformed, and other keys' upload ids", async () => {
    const store = new LocalObjectStore({ rootDirectory: await temporaryDirectory() });
    const { uploadId } = await store.createMultipartUpload("mine.txt");
    for (const id of ["00000000-0000-0000-0000-000000000000", "../metadata", ""]) {
      await expect(store.uploadPart("mine.txt", id, 1, "x")).rejects.toEqual(multipartError("UPLOAD_NOT_FOUND"));
    }
    await expect(store.uploadPart("other.txt", uploadId, 1, "x")).rejects.toEqual(multipartError("UPLOAD_NOT_FOUND"));
    await expect(store.completeMultipartUpload("other.txt", uploadId, [{ partNumber: 1, etag: "x" }]))
      .rejects.toEqual(multipartError("UPLOAD_NOT_FOUND"));
    await expect(store.uploadPart("mine.txt", uploadId, 0, "x")).rejects.toThrow(RangeError);
    // Aborting with another key leaves the upload alone.
    await store.abortMultipartUpload("other.txt", uploadId);
    await expect(store.uploadPart("mine.txt", uploadId, 1, "x")).resolves.toMatchObject({ size: 1 });
  });

  it("aborts idempotently and discards every part", async () => {
    const root = await temporaryDirectory();
    const store = new LocalObjectStore({ rootDirectory: root });
    const { uploadId } = await store.createMultipartUpload("gone.bin");
    await store.uploadPart("gone.bin", uploadId, 1, "data");
    await store.abortMultipartUpload("gone.bin", uploadId);
    await store.abortMultipartUpload("gone.bin", uploadId);
    await store.abortMultipartUpload("gone.bin", "not-an-upload-id");
    expect(await readdir(join(root, ".podokit", "multipart"))).toEqual([]);
    await expect(store.uploadPart("gone.bin", uploadId, 1, "x")).rejects.toBeInstanceOf(MultipartUploadError);
    expect(await store.exists("gone.bin")).toBe(false);
  });

  it("validates keys exactly like put and keeps uploads out of listings", async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const store = new LocalObjectStore({ rootDirectory: root });
    for (const key of ["../outside.txt", "/outside.txt", "a//b"]) {
      await expect(store.createMultipartUpload(key)).rejects.toThrow("safe relative path");
    }
    await expect(store.createMultipartUpload(".podokit/multipart/x")).rejects.toThrow("reserved path");

    await symlink(outside, join(root, "escape"), "dir");
    const { uploadId } = await store.createMultipartUpload("escape/no.txt");
    const uploaded = await store.uploadPart("escape/no.txt", uploadId, 1, "no");
    await expect(store.completeMultipartUpload("escape/no.txt", uploadId, [{ partNumber: 1, etag: uploaded.etag }]))
      .rejects.toThrow("symbolic link");
    expect(await readdir(outside)).toEqual([]);
    expect(await store.list("")).toEqual({ keys: [] });
  });

  it("removes uploads without recent activity", async () => {
    const root = await temporaryDirectory();
    const store = new LocalObjectStore({ rootDirectory: root, multipartMaxAgeMs: 60_000 });
    const stale = await store.createMultipartUpload("stale.bin");
    const active = await store.createMultipartUpload("active.bin");
    await store.uploadPart("stale.bin", stale.uploadId, 1, "old");
    const old = new Date(Date.now() - 120_000);
    await utimes(join(root, ".podokit", "multipart", stale.uploadId), old, old);

    expect(await store.abortStaleMultipartUploads()).toBe(1);
    await expect(store.uploadPart("stale.bin", stale.uploadId, 1, "x")).rejects.toEqual(multipartError("UPLOAD_NOT_FOUND"));
    await expect(store.uploadPart("active.bin", active.uploadId, 1, "x")).resolves.toMatchObject({ size: 1 });

    // A new store sweeps when its first upload starts.
    await utimes(join(root, ".podokit", "multipart", active.uploadId), old, old);
    await new LocalObjectStore({ rootDirectory: root, multipartMaxAgeMs: 60_000 }).createMultipartUpload("next.bin");
    expect(await readdir(join(root, ".podokit", "multipart"))).toHaveLength(1);
    expect(() => new LocalObjectStore({ rootDirectory: root, multipartMaxAgeMs: 0 })).toThrow(RangeError);
  });
});

describe("readObjectBytes", () => {
  it("reads small objects and refuses large ones before reading them", async () => {
    const store = new LocalObjectStore({ rootDirectory: await temporaryDirectory() });
    await store.put("small.txt", "hello");

    expect(Buffer.from((await readObjectBytes(store, "small.txt")) ?? []).toString("utf8")).toBe("hello");
    expect(await readObjectBytes(store, "missing.txt")).toBeNull();
    await expect(readObjectBytes(store, "small.txt", { maxBytes: 4 })).rejects.toThrow("more than 4");
  });
});

describe("objectResponse", () => {
  it("streams the content with its length, type, and validators", async () => {
    const { object } = fakeObject("hello");
    const response = objectResponse(new Request("http://localhost/a"), object, {
      cacheControl: "no-cache",
      headers: { "content-disposition": "inline" },
    });

    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toEqual({
      "cache-control": "no-cache",
      "content-disposition": "inline",
      "content-length": "5",
      "content-type": "text/plain",
      etag: '"v1"',
      "last-modified": "Fri, 02 Jan 2026 03:04:05 GMT",
    });
    expect(await response.text()).toBe("hello");
  });

  it("answers a matching validator with 304 without reading the content", async () => {
    const conditions: Record<string, string>[] = [
      { "if-none-match": '"v1"' },
      { "if-none-match": 'W/"v0", W/"v1"' },
      { "if-none-match": "*" },
      { "if-modified-since": "Fri, 02 Jan 2026 03:04:05 GMT" },
    ];
    for (const headers of conditions) {
      const fake = fakeObject("hello");
      const response = objectResponse(new Request("http://localhost/a", { headers }), fake.object, {
        cacheControl: "public, max-age=31536000, immutable",
      });

      expect(response.status, JSON.stringify(headers)).toBe(304);
      expect(response.headers.get("etag")).toBe('"v1"');
      expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(response.headers.has("content-length")).toBe(false);
      expect(await response.text()).toBe("");
      expect(fake.touched()).toBe("cancelled");
    }
  });

  it("sends the content when the client copy is stale", async () => {
    const conditions: Record<string, string>[] = [
      { "if-none-match": '"v0"' },
      { "if-none-match": '"v0"', "if-modified-since": "Fri, 02 Jan 2026 03:04:05 GMT" },
      { "if-modified-since": "Fri, 02 Jan 2026 03:04:04 GMT" },
      { "if-modified-since": "not a date" },
    ];
    for (const headers of conditions) {
      const fake = fakeObject("hello");
      const response = objectResponse(new Request("http://localhost/a", { headers }), fake.object);
      expect(response.status, JSON.stringify(headers)).toBe(200);
      expect(await response.text()).toBe("hello");
    }
    const { object } = fakeObject("hello");
    expect(objectNotModified(
      new Request("http://localhost/a", { method: "POST", headers: { "if-none-match": "*" } }),
      object,
    )).toBe(false);
  });

  it("uses a replacement content type and answers HEAD without the body", async () => {
    const fake = fakeObject("hello");
    const response = objectResponse(new Request("http://localhost/a", { method: "HEAD" }), fake.object, {
      contentType: "image/png",
    });

    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-length")).toBe("5");
    expect(fake.touched()).toBe("cancelled");
  });
});
