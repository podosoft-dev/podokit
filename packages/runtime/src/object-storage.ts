import type {
  CompletedPart,
  ListObjectsOptions,
  ObjectBody,
  ObjectData,
  ObjectInfo,
  ObjectStore,
} from "./contracts";

export const MAX_OBJECT_LIST_LIMIT = 1000;
export const DEFAULT_MAX_OBJECT_BYTES = 16 * 1024 * 1024;
/** The smallest part S3 accepts, except for the last part of an upload. */
export const MIN_MULTIPART_PART_BYTES = 5 * 1024 * 1024;
/** The most parts one multipart upload may have. */
export const MAX_MULTIPART_PARTS = 10_000;
/**
 * PodoKit's providers read objects up to this size into memory in `get()`. Bun
 * sends a streamed response body with chunked encoding and drops its
 * Content-Length unless the body is in memory or a file
 * (https://github.com/oven-sh/bun/issues/10507), so `objectResponse` keeps the
 * length of these objects only.
 */
export const IN_MEMORY_READ_BYTES = 2 * 1024 * 1024;

export type MultipartUploadErrorCode =
  /** The upload id is unknown, belongs to another key, or was completed, aborted, or expired. */
  | "UPLOAD_NOT_FOUND"
  /** A listed part was never uploaded, or its etag no longer matches. */
  | "INVALID_PART"
  /** A part other than the last is smaller than `MIN_MULTIPART_PART_BYTES`. */
  | "PART_TOO_SMALL";

/** A multipart failure that every provider reports with the same code. */
export class MultipartUploadError extends Error {
  readonly code: MultipartUploadErrorCode;

  constructor(code: MultipartUploadErrorCode, message: string) {
    super(message);
    this.name = "MultipartUploadError";
    this.code = code;
  }
}

async function* streamChunks(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  let finished = false;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) {
        finished = true;
        return;
      }
      yield next.value;
    }
  } finally {
    // A consumer that stops early, or fails, releases the source too.
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

const BLOB_CHUNK_BYTES = 1024 * 1024;

/**
 * Reads a Blob one slice at a time. `Blob.stream()` is avoided because Bun
 * reads a file-backed Blob ahead of a slow consumer, holding the file in memory.
 */
async function* blobChunks(blob: Blob): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < blob.size; offset += BLOB_CHUNK_BYTES) {
    yield new Uint8Array(await blob.slice(offset, offset + BLOB_CHUNK_BYTES).arrayBuffer());
  }
}

function isReadableStream(body: ObjectBody): body is ReadableStream<Uint8Array> {
  return typeof (body as Partial<ReadableStream<Uint8Array>>).getReader === "function";
}

/** Reads any object body as a sequence of byte chunks, without buffering it. */
export async function* objectBodyChunks(body: ObjectBody): AsyncGenerator<Uint8Array> {
  if (typeof body === "string") {
    yield new TextEncoder().encode(body);
  } else if (body instanceof Uint8Array) {
    yield body;
  } else if (body instanceof Blob) {
    yield* blobChunks(body);
  } else if (isReadableStream(body)) {
    yield* streamChunks(body);
  } else {
    for await (const chunk of body) yield chunk;
  }
}

/** Throws a RangeError unless `partNumber` is an integer from 1 to `MAX_MULTIPART_PARTS`. */
export function assertPartNumber(partNumber: number): void {
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_MULTIPART_PARTS) {
    throw new RangeError(`Part number must be an integer from 1 to ${MAX_MULTIPART_PARTS}`);
  }
}

/**
 * Validates the parts given to `completeMultipartUpload` the same way for
 * every provider and returns them in ascending part-number order.
 */
export function normalizeCompletedParts(parts: readonly CompletedPart[]): CompletedPart[] {
  if (parts.length === 0) throw new RangeError("A multipart upload needs at least one part");
  if (parts.length > MAX_MULTIPART_PARTS) {
    throw new RangeError(`A multipart upload has at most ${MAX_MULTIPART_PARTS} parts`);
  }
  const ordered = parts
    .map(({ partNumber, etag }) => {
      assertPartNumber(partNumber);
      if (typeof etag !== "string" || etag.length === 0) {
        throw new TypeError(`Part ${partNumber} needs the etag uploadPart returned`);
      }
      return { partNumber, etag };
    })
    .sort((left, right) => left.partNumber - right.partNumber);
  for (let index = 1; index < ordered.length; index++) {
    if (ordered[index]?.partNumber === ordered[index - 1]?.partNumber) {
      throw new RangeError(`Part ${ordered[index]?.partNumber} is listed more than once`);
    }
  }
  return ordered;
}

/** The page size for `ObjectStore.list`, validated the same way by every provider. */
export function objectListLimit(options: ListObjectsOptions = {}): number {
  const limit = options.limit ?? MAX_OBJECT_LIST_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_OBJECT_LIST_LIMIT) {
    throw new RangeError(`List limit must be an integer from 1 to ${MAX_OBJECT_LIST_LIMIT}`);
  }
  return limit;
}

export interface ReadObjectBytesOptions {
  /** Larger objects are rejected before any content is read. Defaults to 16 MiB. */
  maxBytes?: number;
}

function changedWhileReading(key: string): Error {
  return new Error(`Object ${key} changed while it was being read`);
}

/**
 * Reads a small object into one buffer, or resolves null when it does not
 * exist. Stream anything that can be large from `ObjectStore.get()` instead.
 */
export async function readObjectBytes(
  store: ObjectStore,
  key: string,
  options: ReadObjectBytesOptions = {},
): Promise<Uint8Array | null> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_OBJECT_BYTES;
  const object = await store.get(key);
  if (!object) return null;
  if (object.size > maxBytes) {
    await object.body.cancel();
    throw new RangeError(`Object ${key} has ${object.size} bytes, more than ${maxBytes}`);
  }
  const bytes = new Uint8Array(object.size);
  let offset = 0;
  const reader = object.body.getReader();
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      if (offset + next.value.byteLength > bytes.byteLength) throw changedWhileReading(key);
      bytes.set(next.value, offset);
      offset += next.value.byteLength;
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (offset !== bytes.byteLength) throw changedWhileReading(key);
  return bytes;
}

export interface ObjectResponseOptions {
  /** Replaces the stored content type, for example with one validated on upload. */
  contentType?: string;
  cacheControl?: string;
  /** Added to full responses only, for example Content-Disposition. */
  headers?: Record<string, string>;
}

const ENTITY_TAG = /(?:W\/)?"[^"]*"/g;

function opaqueTag(tag: string): string {
  return tag.startsWith("W/") ? tag.slice(2) : tag;
}

/**
 * Evaluates a conditional GET as RFC 9110 does: If-None-Match decides when
 * present (weak comparison), otherwise If-Modified-Since.
 */
export function objectNotModified(request: Request, object: ObjectInfo): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const noneMatch = request.headers.get("if-none-match");
  if (noneMatch !== null) {
    if (noneMatch.trim() === "*") return true;
    const current = opaqueTag(object.etag);
    return (noneMatch.match(ENTITY_TAG) ?? []).some((tag) => opaqueTag(tag) === current);
  }
  const modifiedSince = request.headers.get("if-modified-since");
  if (modifiedSince === null) return false;
  const since = Date.parse(modifiedSince);
  // HTTP dates carry whole seconds, so compare at that precision.
  const modified = Math.floor(object.lastModified.getTime() / 1000) * 1000;
  return !Number.isNaN(since) && modified <= since;
}

function discard(object: ObjectData): void {
  object.body.cancel().catch(() => undefined);
}

/**
 * Streams an object as an HTTP response with its length and validators, or
 * answers 304 without reading the content when the client copy is current.
 */
export function objectResponse(
  request: Request,
  object: ObjectData,
  options: ObjectResponseOptions = {},
): Response {
  const headers = new Headers({
    etag: object.etag,
    "last-modified": object.lastModified.toUTCString(),
  });
  if (options.cacheControl) headers.set("cache-control", options.cacheControl);
  if (objectNotModified(request, object)) {
    discard(object);
    return new Response(null, { status: 304, headers });
  }
  headers.set("content-type", options.contentType ?? object.contentType ?? "application/octet-stream");
  headers.set("content-length", String(object.size));
  for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value);
  if (request.method === "HEAD") {
    discard(object);
    return new Response(null, { headers });
  }
  return new Response(object.body, { headers });
}
