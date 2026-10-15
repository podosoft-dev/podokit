import { afterEach, describe, expect, it } from "bun:test";
import { SQL } from "bun";
import { Database as SqliteDatabase } from "bun:sqlite";
import type { QueryRunner } from "typeorm";
import { AppException } from "@podosoft/podokit-contracts";
import {
  MAX_MULTIPART_PARTS,
  MultipartUploadError,
  objectBodyChunks,
  type CompletedPart,
  type ObjectBody,
  type ObjectInfo,
  type ObjectStore,
} from "@podosoft/podokit-runtime";
import { Elysia } from "elysia";
import type { RequestIdentity } from "../core/services";
import { revertLatestSqliteMigration, runSqliteMigrations } from "../database/sqlite-migrator";
import { InitFileUploadSessions1792100000000 } from "../migrations/1792100000000-InitFileUploadSessions";
import { ChunkedUploads, COMPLETE_LEASE_MS } from "./chunked-uploads";
import { allowedOrigins, chunkedUploadRoutes } from "./chunked-uploads.routes";
import { filesRoutes } from "./files.module";
import { DEFAULT_UPLOAD_CONFIG, expectedPartSize, partLayout, uploadConfig, type UploadConfig } from "./upload-config";

const MIB = 1024 * 1024;
const PART = 5 * MIB;

async function bytes(body: ObjectBody): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of objectBodyChunks(body)) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function md5(value: Uint8Array): string {
  return `"${new Bun.CryptoHasher("md5").update(value).digest("hex")}"`;
}

interface MemoryStore extends ObjectStore {
  objects: Map<string, Uint8Array>;
  uploads: Map<string, { key: string; parts: Map<number, Uint8Array> }>;
  calls: { complete: number; abort: number };
  failAbort: boolean;
  /** Held completes resolve only when released. */
  holdComplete?: Promise<void>;
}

function memoryStore(): MemoryStore {
  const objects = new Map<string, Uint8Array>();
  const uploads = new Map<string, { key: string; parts: Map<number, Uint8Array> }>();
  const info = (key: string): ObjectInfo | null => {
    const value = objects.get(key);
    return value ? { key, size: value.byteLength, etag: md5(value), lastModified: new Date(0) } : null;
  };
  const upload = (key: string, uploadId: string): { key: string; parts: Map<number, Uint8Array> } => {
    const found = uploads.get(uploadId);
    if (!found || found.key !== key) throw new MultipartUploadError("UPLOAD_NOT_FOUND", "no such upload");
    return found;
  };
  const store: MemoryStore = {
    objects,
    uploads,
    calls: { complete: 0, abort: 0 },
    failAbort: false,
    put: async (key, body) => {
      const value = await bytes(body);
      objects.set(key, value);
      return { key, size: value.byteLength };
    },
    get: async () => null,
    stat: async (key) => info(key),
    list: async () => ({ keys: [] }),
    exists: async (key) => objects.has(key),
    delete: async (key) => {
      objects.delete(key);
    },
    getDownloadUrl: async (key) => `https://storage.example.com/${key}`,
    createMultipartUpload: async (key) => {
      const uploadId = crypto.randomUUID();
      uploads.set(uploadId, { key, parts: new Map() });
      return { uploadId };
    },
    uploadPart: async (key, uploadId, partNumber, body) => {
      const target = upload(key, uploadId);
      const value = await bytes(body);
      target.parts.set(partNumber, value);
      return { etag: md5(value), size: value.byteLength };
    },
    completeMultipartUpload: async (key, uploadId, parts: readonly CompletedPart[]) => {
      store.calls.complete += 1;
      await store.holdComplete;
      const target = upload(key, uploadId);
      const ordered = parts.map(({ partNumber, etag }) => {
        const value = target.parts.get(partNumber);
        if (!value || md5(value) !== etag) throw new MultipartUploadError("INVALID_PART", `part ${partNumber}`);
        return value;
      });
      uploads.delete(uploadId);
      objects.set(key, Buffer.concat(ordered));
      return info(key) as ObjectInfo;
    },
    abortMultipartUpload: async (_key, uploadId) => {
      store.calls.abort += 1;
      if (store.failAbort) throw new Error("storage is unavailable");
      uploads.delete(uploadId);
    },
    close: () => undefined,
  };
  return store;
}

let open: SQL | undefined;

afterEach(async () => {
  await open?.close();
  open = undefined;
});

async function database(): Promise<SQL> {
  const sql = new SQL(":memory:");
  open = sql;
  await sql`PRAGMA foreign_keys = ON`;
  const runner = {
    connection: { options: { type: "better-sqlite3" } },
    query: (query: string): Promise<unknown> => sql.unsafe(query),
  } as unknown as QueryRunner;
  await new InitFileUploadSessions1792100000000().up(runner);
  return sql;
}

interface Harness {
  sql: SQL;
  store: MemoryStore;
  clock: { now: number };
  uploads: ChunkedUploads;
  replica: () => ChunkedUploads;
}

const CONFIG: UploadConfig = { ...DEFAULT_UPLOAD_CONFIG, partBytes: PART, sessionTtlSeconds: 600 };

async function harness(config: UploadConfig = CONFIG): Promise<Harness> {
  const sql = await database();
  const store = memoryStore();
  const clock = { now: Date.parse("2026-01-01T00:00:00.000Z") };
  const replica = (): ChunkedUploads =>
    new ChunkedUploads({ sql, dialect: "sqlite", config, storage: () => store, now: () => clock.now });
  return { sql, store, clock, uploads: replica(), replica };
}

function content(size: number, seed = 7): Uint8Array {
  const value = new Uint8Array(size);
  for (let index = 0; index < size; index++) value[index] = (index * 31 + seed) % 251;
  return value;
}

function streamOf(value: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller): void {
      controller.enqueue(value);
      controller.close();
    },
  });
}

function slicePart(file: Uint8Array, partSize: number, partNumber: number): Uint8Array {
  return file.subarray((partNumber - 1) * partSize, partNumber * partSize);
}

async function code(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
  } catch (error) {
    if (error instanceof AppException) return `${error.statusCode} ${error.code}`;
    throw error;
  }
  throw new Error("expected the operation to fail");
}

async function sendAll(
  uploads: ChunkedUploads,
  owner: string | undefined,
  id: string,
  file: Uint8Array,
  partSize: number,
  partCount: number,
): Promise<void> {
  for (let number = 1; number <= partCount; number++) {
    const part = slicePart(file, partSize, number);
    await uploads.putPart(owner, id, number, part.byteLength, streamOf(part));
  }
}

describe("part layout", () => {
  it("uses the configured part size with a smaller last part", () => {
    const layout = partLayout(12 * MIB + 3, 8 * MIB);
    expect(layout).toEqual({ partSize: 8 * MIB, partCount: 2 });
    expect(expectedPartSize(12 * MIB + 3, layout, 1)).toBe(8 * MIB);
    expect(expectedPartSize(12 * MIB + 3, layout, 2)).toBe(4 * MIB + 3);
  });

  it("keeps a small file in one part and exact multiples without a remainder", () => {
    expect(partLayout(10, 8 * MIB)).toEqual({ partSize: 8 * MIB, partCount: 1 });
    expect(expectedPartSize(10, partLayout(10, 8 * MIB), 1)).toBe(10);
    const exact = partLayout(16 * MIB, 8 * MIB);
    expect(exact.partCount).toBe(2);
    expect(expectedPartSize(16 * MIB, exact, 2)).toBe(8 * MIB);
  });

  it("grows the part size in whole MiB to stay within the part limit", () => {
    const size = 100 * 1024 * MIB;
    const layout = partLayout(size, 8 * MIB);
    expect(layout.partSize % MIB).toBe(0);
    expect(layout.partSize).toBeGreaterThan(8 * MIB);
    expect(layout.partCount).toBeLessThanOrEqual(MAX_MULTIPART_PARTS);
    expect(partLayout(size, layout.partSize - MIB).partSize).toBe(layout.partSize);
  });
});

describe("upload configuration", () => {
  it("reads defaults and overrides", () => {
    expect(uploadConfig({}, 128 * MIB)).toEqual(DEFAULT_UPLOAD_CONFIG);
    expect(uploadConfig({
      FILE_UPLOAD_MAX_BYTES: "1048576",
      FILE_UPLOAD_PART_BYTES: String(16 * MIB),
      FILE_UPLOAD_SESSION_TTL: "3600",
      FILE_UPLOAD_SWEEP_INTERVAL: "0",
      FILE_UPLOAD_RATE_LIMIT_MAX: "50",
    }, 128 * MIB)).toEqual({
      maxBytes: MIB,
      partBytes: 16 * MIB,
      sessionTtlSeconds: 3600,
      sweepIntervalSeconds: 0,
      rateLimitMax: 50,
    });
  });

  it("rejects parts below the storage minimum and invalid numbers", () => {
    expect(() => uploadConfig({ FILE_UPLOAD_PART_BYTES: String(4 * MIB) }, 128 * MIB)).toThrow("FILE_UPLOAD_PART_BYTES");
    expect(() => uploadConfig({ FILE_UPLOAD_MAX_BYTES: "1.5" }, 128 * MIB)).toThrow("FILE_UPLOAD_MAX_BYTES");
    expect(() => uploadConfig({ FILE_UPLOAD_SESSION_TTL: "-1" }, 128 * MIB)).toThrow("FILE_UPLOAD_SESSION_TTL");
  });

  it("refuses a part size the API body limit cannot accept", () => {
    expect(() => uploadConfig({ FILE_UPLOAD_PART_BYTES: String(64 * MIB) }, 32 * MIB)).toThrow("API_MAX_REQUEST_BODY_SIZE");
    // 1 TiB in at most 10,000 parts needs parts over 100 MiB.
    expect(() => uploadConfig({ FILE_UPLOAD_MAX_BYTES: String(1024 * 1024 * MIB) }, 100 * MIB)).toThrow("body limit");
  });
});

describe("chunked uploads", () => {
  it("stores a file sent in parts, with a retried part, and resumes from the status", async () => {
    const { uploads, store } = await harness();
    const file = content(2 * PART + 1234);
    const created = await uploads.create("user_1", { filename: "report.bin", size: file.byteLength, contentType: "application/pdf" });
    expect(created).toMatchObject({ partSize: PART, partCount: 3, expiresAt: "2026-01-01T00:10:00.000Z" });

    await uploads.putPart("user_1", created.id, 3, 1234, streamOf(slicePart(file, PART, 3)));
    await uploads.putPart("user_1", created.id, 1, PART, streamOf(slicePart(file, PART, 1)));
    // A retry of the same part replaces it.
    await uploads.putPart("user_1", created.id, 1, PART, streamOf(slicePart(file, PART, 1)));
    const status = await uploads.status("user_1", created.id);
    expect(status).toMatchObject({ status: "open", size: file.byteLength, receivedParts: [1, 3], filename: "report.bin" });
    expect(status.key).toBeUndefined();

    expect(await code(uploads.complete("user_1", created.id))).toBe("409 UPLOAD_INCOMPLETE");
    await uploads.putPart("user_1", created.id, 2, PART, streamOf(slicePart(file, PART, 2)));
    const done = await uploads.complete("user_1", created.id);
    expect(done).toMatchObject({ status: "completed", size: file.byteLength, contentType: "application/pdf" });
    expect(done.key).toMatch(new RegExp(`^uploads/user_1/${created.id}-report\\.bin$`));
    expect(done.url).toBe(`https://storage.example.com/${done.key}`);
    expect(Buffer.compare(store.objects.get(done.key) ?? new Uint8Array(), file)).toBe(0);
    expect((await uploads.status("user_1", created.id)).key).toBe(done.key);
  });

  it("rejects sizes over the limit and parts of the wrong size", async () => {
    const { uploads } = await harness({ ...CONFIG, maxBytes: 3 * PART });
    expect(await code(uploads.create("user_1", { filename: "big", size: 3 * PART + 1 }))).toBe("413 UPLOAD_TOO_LARGE");
    const { id } = await uploads.create("user_1", { filename: "a", size: PART + 10 });
    const part = content(PART);
    expect(await code(uploads.putPart("user_1", id, 1, PART - 1, streamOf(part)))).toBe("400 UPLOAD_PART_SIZE_MISMATCH");
    expect(await code(uploads.putPart("user_1", id, 2, PART, streamOf(part)))).toBe("400 UPLOAD_PART_SIZE_MISMATCH");
    expect(await code(uploads.putPart("user_1", id, 1, null, streamOf(part)))).toBe("411 UPLOAD_LENGTH_REQUIRED");
    expect(await code(uploads.putPart("user_1", id, 3, 10, streamOf(part)))).toBe("400 UPLOAD_PART_OUT_OF_RANGE");
    // A body that ends before its declared length is refused and not recorded.
    expect(await code(uploads.putPart("user_1", id, 1, PART, streamOf(part.subarray(0, 100))))).toBe("400 UPLOAD_PART_SIZE_MISMATCH");
    expect((await uploads.status("user_1", id)).receivedParts).toEqual([]);
  });

  it("hides uploads from everyone but their owner", async () => {
    const { uploads } = await harness();
    const { id } = await uploads.create("user_1", { filename: "a", size: 10 });
    const part = content(10);
    expect(await code(uploads.status("user_2", id))).toBe("404 UPLOAD_NOT_FOUND");
    expect(await code(uploads.status(undefined, id))).toBe("404 UPLOAD_NOT_FOUND");
    expect(await code(uploads.putPart("user_2", id, 1, 10, streamOf(part)))).toBe("404 UPLOAD_NOT_FOUND");
    expect(await code(uploads.complete("user_2", id))).toBe("404 UPLOAD_NOT_FOUND");
    expect(await code(uploads.abort("user_2", id))).toBe("404 UPLOAD_NOT_FOUND");
    expect(await code(uploads.status("user_1", "not-a-uuid"))).toBe("404 UPLOAD_NOT_FOUND");
    expect((await uploads.status("user_1", id)).status).toBe("open");
  });

  it("lets exactly one of two concurrent completes assemble the object", async () => {
    const { uploads, store, replica } = await harness();
    const file = content(PART + 5);
    const created = await uploads.create("user_1", { filename: "a", size: file.byteLength });
    await sendAll(uploads, "user_1", created.id, file, PART, created.partCount);

    let release = (): void => undefined;
    store.holdComplete = new Promise((resolve) => { release = resolve; });
    const first = uploads.complete("user_1", created.id);
    await Bun.sleep(5);
    expect(await code(replica().complete("user_1", created.id))).toBe("409 UPLOAD_COMPLETING");
    expect(await code(replica().putPart("user_1", created.id, 2, 5, streamOf(content(5))))).toBe("409 UPLOAD_COMPLETING");
    expect(await code(replica().abort("user_1", created.id))).toBe("409 UPLOAD_COMPLETING");
    release();
    const done = await first;
    expect(store.calls.complete).toBe(1);

    // Completing again returns the stored result without a second assembly.
    expect(await replica().complete("user_1", created.id)).toEqual(done);
    expect(store.calls.complete).toBe(1);
    expect(await code(uploads.abort("user_1", created.id))).toBe("409 UPLOAD_COMPLETED");
  });

  it("claims completion with a conditional update when both requests saw it open", async () => {
    const { uploads, store, replica } = await harness();
    const created = await uploads.create("user_1", { filename: "a", size: 10 });
    await uploads.putPart("user_1", created.id, 1, 10, streamOf(content(10)));

    let release = (): void => undefined;
    store.holdComplete = new Promise((resolve) => { release = resolve; });
    const attempts = [uploads.complete("user_1", created.id), replica().complete("user_1", created.id)]
      .map((attempt) => attempt.then(
        (result) => result.status,
        (error: unknown) => error instanceof AppException ? error.code : "unexpected",
      ));
    await Bun.sleep(5);
    release();
    expect((await Promise.all(attempts)).sort()).toEqual(["UPLOAD_COMPLETING", "completed"]);
    expect(store.calls.complete).toBe(1);
  });

  it("reopens the upload when storage rejects a changed part", async () => {
    const { uploads, store } = await harness();
    const created = await uploads.create("user_1", { filename: "a", size: 10 });
    await uploads.putPart("user_1", created.id, 1, 10, streamOf(content(10)));
    for (const upload of store.uploads.values()) upload.parts.set(1, content(10, 99));

    expect(await code(uploads.complete("user_1", created.id))).toBe("409 UPLOAD_INVALID_PART");
    expect((await uploads.status("user_1", created.id)).status).toBe("open");
    await uploads.putPart("user_1", created.id, 1, 10, streamOf(content(10)));
    expect((await uploads.complete("user_1", created.id)).size).toBe(10);
  });

  it("aborts on request and refuses later parts", async () => {
    const { uploads, store } = await harness();
    const created = await uploads.create("user_1", { filename: "a", size: 10 });
    await uploads.abort("user_1", created.id);
    expect(store.uploads.size).toBe(0);
    expect((await uploads.status("user_1", created.id)).status).toBe("aborted");
    expect(await code(uploads.putPart("user_1", created.id, 1, 10, streamOf(content(10))))).toBe("410 UPLOAD_ABORTED");
    expect(await code(uploads.complete("user_1", created.id))).toBe("410 UPLOAD_ABORTED");
    await uploads.abort("user_1", created.id);
    expect(store.calls.abort).toBe(1);
  });

  it("marks an upload storage no longer knows as gone", async () => {
    const { uploads, store } = await harness();
    const created = await uploads.create("user_1", { filename: "a", size: 10 });
    store.uploads.clear();
    expect(await code(uploads.putPart("user_1", created.id, 1, 10, streamOf(content(10))))).toBe("404 UPLOAD_NOT_FOUND");
    expect((await uploads.status("user_1", created.id)).status).toBe("aborted");
  });

  it("expires idle uploads and lets only one sweeping replica abort each", async () => {
    const { uploads, store, clock, replica } = await harness();
    const ids: string[] = [];
    for (let index = 0; index < 3; index++) {
      ids.push((await uploads.create("user_1", { filename: `f${index}`, size: 10 })).id);
    }
    const active = await uploads.create("user_1", { filename: "active", size: PART + 1 });
    clock.now += 500_000;
    // Storing a part restarts the idle clock.
    await uploads.putPart("user_1", active.id, 1, PART, streamOf(content(PART)));
    clock.now += 200_000;

    const first = ids[0] ?? "";
    expect(await code(uploads.putPart("user_1", first, 1, 10, streamOf(content(10))))).toBe("410 UPLOAD_EXPIRED");
    const results = await Promise.all([replica().sweep(), replica().sweep()]);
    expect(results.reduce((sum, result) => sum + result.expired, 0)).toBe(3);
    expect(store.calls.abort).toBe(3);
    expect(store.uploads.size).toBe(1);
    expect((await uploads.status("user_1", first)).status).toBe("aborted");
    expect((await uploads.status("user_1", active.id)).status).toBe("open");
    expect((await uploads.sweep()).expired).toBe(0);
  });

  it("retries a failed storage abort and deletes finished records after retention", async () => {
    const { uploads, store, clock } = await harness();
    const created = await uploads.create("user_1", { filename: "a", size: 10 });
    store.failAbort = true;
    await uploads.abort("user_1", created.id);
    expect(store.uploads.size).toBe(1);

    store.failAbort = false;
    // Retried once a sweep interval has passed since the failed attempt.
    clock.now += 60_000;
    expect((await uploads.sweep()).released).toBe(0);
    clock.now += 241_000;
    expect(await uploads.sweep()).toMatchObject({ released: 1, deleted: 0 });
    expect(store.uploads.size).toBe(0);

    clock.now += 600_000;
    expect((await uploads.sweep()).deleted).toBe(1);
    expect(await code(uploads.status("user_1", created.id))).toBe("404 UPLOAD_NOT_FOUND");
  });

  it("settles uploads a stopped replica left completing", async () => {
    const { uploads, store, clock, sql } = await harness();
    const stored = await uploads.create("user_1", { filename: "stored", size: 10 });
    const lost = await uploads.create("user_1", { filename: "lost", size: 10 });
    for (const { id } of [stored, lost]) {
      await uploads.putPart("user_1", id, 1, 10, streamOf(content(10)));
    }
    await sql`UPDATE "file_upload_sessions" SET "status" = 'completing'`;
    const storedKey = (await sql<Array<{ objectKey: string }>>`
      SELECT "objectKey" FROM "file_upload_sessions" WHERE "id" = ${stored.id}
    `)[0]?.objectKey ?? "";
    // The stopped replica's storage complete went through for this one.
    store.objects.set(storedKey, content(10));
    for (const [uploadId, upload] of store.uploads) {
      if (upload.key === storedKey) store.uploads.delete(uploadId);
    }

    expect((await uploads.sweep()).recovered).toBe(0);
    clock.now += COMPLETE_LEASE_MS + 1;
    expect((await uploads.sweep()).recovered).toBe(2);
    expect((await uploads.status("user_1", stored.id)).status).toBe("completed");
    expect((await uploads.status("user_1", lost.id)).status).toBe("aborted");
    expect(store.uploads.size).toBe(0);
  });

  it("stops the sweep timer on close", async () => {
    const { uploads } = await harness({ ...CONFIG, sweepIntervalSeconds: 1 });
    uploads.start();
    await uploads.close();
    uploads.start();
    await uploads.close();
  });
});

describe("chunked upload routes", () => {
  const WEB = "http://localhost:5001";

  function caller(userId: string | undefined): RequestIdentity {
    return {
      userId: async () => userId,
      isAdmin: async () => false,
      roles: async () => [],
      activeOrganizationId: async () => undefined,
    };
  }

  interface Handler {
    handle(request: Request): Promise<Response>;
  }

  interface Reply {
    status: number;
    body: Record<string, unknown>;
  }

  async function app(): Promise<{ handle: (request: Request) => Promise<Reply>; store: MemoryStore }> {
    const { uploads, store } = await harness();
    const identities = new Map([["alice", caller("user_1")], ["bob", caller("user_2")]]);
    const routes = (user: string): Handler => new Elysia()
      .onError(({ error, set }) => {
        if (!(error instanceof AppException)) return undefined;
        set.status = error.statusCode;
        return { code: error.code };
      })
      .use(filesRoutes(store, identities.get(user) ?? caller(undefined)))
      .use(chunkedUploadRoutes(uploads, identities.get(user) ?? caller(undefined), allowedOrigins(`${WEB}/, http://example.com`)));
    const apps = new Map([...identities.keys()].map((user) => [user, routes(user)]));
    return {
      store,
      handle: async (request) => {
        const user = request.headers.get("x-test-user") ?? "alice";
        const response = await (apps.get(user) ?? routes(user)).handle(request);
        const text = await response.text();
        return { status: response.status, body: text ? JSON.parse(text) as Record<string, unknown> : {} };
      },
    };
  }

  function json(path: string, body: unknown, headers: Record<string, string> = {}): Request {
    return new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: WEB, ...headers },
      body: JSON.stringify(body),
    });
  }

  function part(path: string, value: Uint8Array, headers: Record<string, string> = {}): Request {
    return new Request(`http://localhost${path}`, {
      method: "PUT",
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(value.byteLength),
        origin: WEB,
        ...headers,
      },
      // A copy owns a plain ArrayBuffer, which the BodyInit type requires.
      body: value.slice(),
    });
  }

  it("runs an upload over HTTP", async () => {
    const { handle, store } = await app();
    const file = content(PART + 3);
    const created = await handle(json("/files/uploads", { filename: "a.bin", size: file.byteLength }));
    expect(created.status).toBe(201);
    const id = String(created.body.id);
    expect(created.body).toMatchObject({ partSize: PART, partCount: 2 });

    expect(await handle(part(`/files/uploads/${id}/parts/1`, slicePart(file, PART, 1)))).toEqual({
      status: 200,
      body: { partNumber: 1, size: PART },
    });
    expect((await handle(part(`/files/uploads/${id}/parts/2`, slicePart(file, PART, 2)))).status).toBe(200);
    expect((await handle(new Request(`http://localhost/files/uploads/${id}`))).body.receivedParts).toEqual([1, 2]);
    const done = await handle(json(`/files/uploads/${id}/complete`, {}));
    expect(done).toMatchObject({ status: 200, body: { status: "completed", size: file.byteLength } });
    expect(store.objects.get(String(done.body.key))?.byteLength).toBe(file.byteLength);

    // The presign route still matches encoded keys next to the upload routes.
    const presign = await handle(new Request(`http://localhost/files/${encodeURIComponent(String(done.body.key))}/url`));
    expect(presign).toEqual({ status: 200, body: { url: `https://storage.example.com/${String(done.body.key)}` } });

    const removed = await handle(new Request(`http://localhost/files/uploads/${id}`, { method: "DELETE", headers: { origin: WEB } }));
    expect(removed).toEqual({ status: 409, body: { code: "UPLOAD_COMPLETED" } });
  });

  it("answers another user with 404 and cancels on DELETE", async () => {
    const { handle } = await app();
    const created = await handle(json("/files/uploads", { filename: "a", size: 10 }));
    const id = String(created.body.id);
    const bob = { "x-test-user": "bob" };
    expect((await handle(new Request(`http://localhost/files/uploads/${id}`, { headers: bob }))).status).toBe(404);
    expect((await handle(part(`/files/uploads/${id}/parts/1`, content(10), bob))).body).toEqual({ code: "UPLOAD_NOT_FOUND" });
    expect((await handle(new Request(`http://localhost/files/uploads/${id}`, { method: "DELETE", headers: bob }))).status).toBe(404);

    expect((await handle(new Request(`http://localhost/files/uploads/${id}`, { method: "DELETE" }))).status).toBe(204);
    expect((await handle(new Request(`http://localhost/files/uploads/${id}`))).body.status).toBe("aborted");
  });

  it("requires JSON or binary content types so cross-origin calls are preflighted", async () => {
    const { handle } = await app();
    const form = new Request("http://localhost/files/uploads", {
      method: "POST",
      headers: { "content-type": "text/plain", origin: WEB },
      body: JSON.stringify({ filename: "a", size: 10 }),
    });
    expect(await handle(form)).toEqual({ status: 415, body: { code: "UNSUPPORTED_MEDIA_TYPE" } });
    const urlencoded = new Request("http://localhost/files/uploads", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "filename=a&size=10",
    });
    expect((await handle(urlencoded)).status).toBe(415);

    const id = String((await handle(json("/files/uploads", { filename: "a", size: 10 }))).body.id);
    expect(await handle(part(`/files/uploads/${id}/parts/1`, content(10), { "content-type": "text/plain" }))).toEqual({
      status: 415,
      body: { code: "UNSUPPORTED_MEDIA_TYPE" },
    });
    const complete = new Request(`http://localhost/files/uploads/${id}/complete`, { method: "POST" });
    expect(await handle(complete)).toEqual({ status: 415, body: { code: "UNSUPPORTED_MEDIA_TYPE" } });
    expect((await handle(new Request(`http://localhost/files/uploads/${id}`))).body.receivedParts).toEqual([]);
  });

  it("rejects a browser origin outside CORS_ORIGIN", async () => {
    const { handle } = await app();
    const foreign = { origin: "https://attacker.example.net" };
    expect(await handle(json("/files/uploads", { filename: "a", size: 10 }, foreign))).toEqual({
      status: 403,
      body: { code: "ORIGIN_NOT_ALLOWED" },
    });
    expect((await handle(json("/files/uploads", { filename: "a", size: 10 }, { origin: "http://example.com" }))).status).toBe(201);
    const id = String((await handle(json("/files/uploads", { filename: "a", size: 10 }))).body.id);
    expect((await handle(part(`/files/uploads/${id}/parts/1`, content(10), foreign))).status).toBe(403);
    expect((await handle(new Request(`http://localhost/files/uploads/${id}`, { method: "DELETE", headers: foreign }))).status).toBe(403);
  });

  it("refuses a part without a valid Content-Length", async () => {
    const { handle } = await app();
    const id = String((await handle(json("/files/uploads", { filename: "a", size: 10 }))).body.id);
    expect((await handle(part(`/files/uploads/${id}/parts/1`, content(10), { "content-length": "9" }))).body)
      .toEqual({ code: "UPLOAD_PART_SIZE_MISMATCH" });
  });
});

describe("upload session migration", () => {
  function runner(type: "postgres" | "better-sqlite3", queries: string[]): QueryRunner {
    return {
      connection: { options: { type } },
      query: (sql: string): Promise<unknown[]> => {
        queries.push(sql);
        return Promise.resolve([]);
      },
    } as unknown as QueryRunner;
  }

  it("uses uuid and timestamptz columns on PostgreSQL", async () => {
    const queries: string[] = [];
    await new InitFileUploadSessions1792100000000().up(runner("postgres", queries));
    expect(queries[0]).toContain('"id" uuid NOT NULL');
    expect(queries[0]).toContain('"expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL');
    expect(queries[2]).toContain("ON DELETE CASCADE");
  });

  it("migrates up and down on SQLite", async () => {
    const sqlite = new SqliteDatabase(":memory:");
    const migrations = [{ timestamp: 1792100000000, migration: new InitFileUploadSessions1792100000000() }];
    const tables = (): string[] => sqlite
      .query<{ name: string }, []>(`SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' AND "name" LIKE 'file_upload%' ORDER BY "name"`)
      .all()
      .map((row) => row.name);
    try {
      await runSqliteMigrations(sqlite, migrations);
      expect(tables()).toEqual(["file_upload_parts", "file_upload_sessions"]);
      expect(await revertLatestSqliteMigration(sqlite, migrations)).toBe(true);
      expect(tables()).toEqual([]);
    } finally {
      sqlite.close();
    }
  });
});
