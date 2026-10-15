import { afterAll, describe, expect, it } from "bun:test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { MIN_MULTIPART_PART_BYTES, MultipartUploadError } from "@podosoft/podokit-runtime";
import { ReadinessService } from "../health/readiness.service";
import { S3ObjectStore } from "./s3-object.store";
import { EMPTY_PAYLOAD_HASH, signS3Request } from "./s3-signer";
import { storageSettings } from "./storage.config";
import { STREAM_PART_BYTES, StorageService } from "./storage.service";

async function* chunks(content: Uint8Array, size = 256 * 1024): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < content.byteLength; offset += size) yield content.subarray(offset, offset + size);
}

function digest(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

async function readAll(store: S3ObjectStore, key: string): Promise<Uint8Array> {
  const object = await store.get(key);
  if (!object) throw new Error(`expected ${key}`);
  return new Uint8Array(await new Response(object.body).arrayBuffer());
}

/**
 * Lists unfinished multipart uploads of one key (path-style endpoints only).
 * MinIO-compatible services match the prefix against the whole key.
 */
async function pendingUploads(key: string): Promise<string[]> {
  const settings = storageSettings();
  const signed = signS3Request({
    method: "GET",
    url: new URL(`${settings.endpoint}/${settings.bucket}/`),
    query: [["uploads", ""], ["prefix", key]],
    payloadHash: EMPTY_PAYLOAD_HASH,
  }, {
    accessKeyId: settings.accessKeyId ?? "",
    secretAccessKey: settings.secretAccessKey ?? "",
  }, settings.region);
  const response = await fetch(signed.url, { headers: signed.headers });
  const xml = await response.text();
  if (!response.ok) throw new Error(`ListMultipartUploads failed: ${xml}`);
  return [...xml.matchAll(/<UploadId>([^<]+)<\/UploadId>/g)].map((match) => match[1] ?? "");
}

// Runs against the bucket in the S3_* settings, like the storage API spec.
const integration = process.env.S3_ENDPOINT ? describe : describe.skip;

integration("S3ObjectStore against a live bucket", () => {
  const storage = new StorageService(new ReadinessService());
  const store = new S3ObjectStore(storage);
  const prefix = `podokit-test/${randomUUID()}/`;
  const created: string[] = [];

  async function put(name: string, content: Uint8Array | string, contentType?: string): Promise<string> {
    const key = `${prefix}${name}`;
    created.push(key);
    await store.put(key, content, contentType ? { contentType } : {});
    return key;
  }

  afterAll(async () => {
    await Promise.all(created.map((key) => storage.delete(key)));
    storage.close();
  });

  it("describes an object and streams exactly its content", async () => {
    const content = randomBytes(3 * 1024 * 1024);
    const key = await put("object.bin", content, "application/octet-stream");

    const info = await store.stat(key);
    expect(info).toMatchObject({ key, size: content.byteLength, contentType: "application/octet-stream" });
    expect(info?.etag).toMatch(/^"[^"]+"$/);
    expect(info?.lastModified).toBeInstanceOf(Date);

    const object = await store.get(key);
    if (!object) throw new Error("expected the stored object");
    expect(object.etag).toBe(info?.etag ?? "");
    const streamed = Buffer.from(await new Response(object.body).arrayBuffer());
    expect(streamed.equals(content)).toBe(true);
  });

  it("lists keys a page at a time", async () => {
    const names = ["list/a.txt", "list/b.txt", "list/c/d.txt", "list/e.txt", "listed.txt"];
    for (const name of names) await put(name, name);

    const pages: string[][] = [];
    let cursor: string | undefined;
    do {
      const page = await store.list(`${prefix}list/`, { limit: 2, ...(cursor ? { cursor } : {}) });
      pages.push(page.keys.map((key) => key.slice(prefix.length)));
      cursor = page.nextCursor;
    } while (cursor !== undefined);

    expect(pages).toEqual([["list/a.txt", "list/b.txt"], ["list/c/d.txt", "list/e.txt"]]);
    expect((await store.list(`${prefix}list`)).keys).toHaveLength(names.length);
    await expect(store.list(prefix, { limit: 0 })).rejects.toThrow("from 1 to 1000");
  });

  it("reports a missing key as null and lets an unread body be dropped", async () => {
    expect(await store.get(`${prefix}missing`)).toBeNull();
    expect(await store.stat(`${prefix}missing`)).toBeNull();

    const key = await put("unread.txt", "unread", "text/plain");
    const object = await store.get(key);
    if (!object) throw new Error("expected the stored object");
    await object.body.cancel();
    expect(object.size).toBe(6);
  });

  it("streams a body larger than one part and removes nothing on success", async () => {
    const content = randomBytes(2 * STREAM_PART_BYTES + 12345);
    const key = `${prefix}streamed.bin`;
    created.push(key);
    const stored = await store.put(key, chunks(content), { contentType: "application/octet-stream" });
    expect(stored).toMatchObject({ key, size: content.byteLength });
    expect(await store.stat(key)).toMatchObject({ size: content.byteLength, contentType: "application/octet-stream" });
    expect(digest(await readAll(store, key))).toBe(digest(content));

    const fromStream = `${prefix}from-stream.bin`;
    created.push(fromStream);
    await store.put(fromStream, new Response(content).body as ReadableStream<Uint8Array>);
    expect(digest(await readAll(store, fromStream))).toBe(digest(content));

    const empty = `${prefix}empty.bin`;
    created.push(empty);
    expect(await store.put(empty, chunks(new Uint8Array(0)))).toMatchObject({ size: 0 });
    expect(await store.stat(empty)).toMatchObject({ size: 0 });
  });

  it("aborts a streamed write whose source fails, leaving no object or upload", async () => {
    const key = `${prefix}failed/stream.bin`;
    async function* failing(): AsyncGenerator<Uint8Array> {
      yield* chunks(randomBytes(STREAM_PART_BYTES + 1024));
      throw new Error("client went away");
    }
    await expect(store.put(key, failing())).rejects.toThrow("client went away");
    expect(await store.exists(key)).toBe(false);
    expect(await pendingUploads(key)).toEqual([]);
  });

  it("assembles parts uploaded out of order under a key with reserved characters", async () => {
    const key = `${prefix}multipart/a b+c&d=é.bin`;
    created.push(key);
    const first = randomBytes(MIN_MULTIPART_PART_BYTES);
    const second = randomBytes(1000);
    const { uploadId } = await store.createMultipartUpload(key, { contentType: "video/mp4" });
    expect(await pendingUploads(key)).toEqual([uploadId]);

    const uploadedSecond = await store.uploadPart(key, uploadId, 2, chunks(second, 100));
    const uploadedFirst = await store.uploadPart(key, uploadId, 1, new Blob([first]));
    expect(uploadedFirst.size).toBe(first.byteLength);
    expect(uploadedSecond).toMatchObject({ size: second.byteLength });

    const info = await store.completeMultipartUpload(key, uploadId, [
      { partNumber: 2, etag: uploadedSecond.etag },
      { partNumber: 1, etag: uploadedFirst.etag },
    ]);
    expect(info).toMatchObject({ key, size: first.byteLength + second.byteLength, contentType: "video/mp4" });
    expect(info.etag).toMatch(/^"[^"]+-2"$/);
    expect(digest(await readAll(store, key))).toBe(digest(Buffer.concat([first, second])));
    expect((await store.list(`${prefix}multipart/`)).keys).toEqual([key]);
    expect(await pendingUploads(key)).toEqual([]);
  });

  it("reports multipart failures with provider-neutral codes", async () => {
    const key = `${prefix}multipart-errors.bin`;
    const codeOf = async (operation: Promise<unknown>): Promise<string | undefined> => {
      const error = await operation.then(() => undefined, (failure: unknown) => failure);
      return error instanceof MultipartUploadError ? error.code : undefined;
    };
    const { uploadId } = await store.createMultipartUpload(key);
    const small = await store.uploadPart(key, uploadId, 1, "small");
    const last = await store.uploadPart(key, uploadId, 2, "last");

    expect(await codeOf(store.completeMultipartUpload(key, uploadId, [{ partNumber: 1, etag: "\"0\"" }])))
      .toBe("INVALID_PART");
    expect(await codeOf(store.completeMultipartUpload(key, uploadId, [
      { partNumber: 1, etag: small.etag },
      { partNumber: 2, etag: last.etag },
    ]))).toBe("PART_TOO_SMALL");

    await store.abortMultipartUpload(key, uploadId);
    await store.abortMultipartUpload(key, uploadId);
    expect(await codeOf(store.uploadPart(key, uploadId, 1, "late"))).toBe("UPLOAD_NOT_FOUND");
    expect(await codeOf(store.completeMultipartUpload(key, uploadId, [{ partNumber: 1, etag: small.etag }])))
      .toBe("UPLOAD_NOT_FOUND");
    expect(await store.exists(key)).toBe(false);
  });

  it("rejects keys that a request URL would rewrite, for put and multipart alike", async () => {
    for (const key of [`${prefix}a/../b`, `${prefix}./b`, ""]) {
      await expect(store.put(key, "x")).rejects.toThrow("Object key");
      await expect(store.createMultipartUpload(key)).rejects.toThrow("Object key");
    }
    await expect(store.uploadPart(`${prefix}a`, "id", 0, "x")).rejects.toThrow(RangeError);
  });

  it("fails the stream rather than mix in content written after the metadata was read", async () => {
    const key = await put("replaced.txt", "before", "text/plain");
    const object = await store.get(key);
    if (!object) throw new Error("expected the stored object");
    await store.put(key, "after!", { contentType: "text/plain" });

    await expect(new Response(object.body).text()).rejects.toThrow("changed while it was being read");
  });
});
