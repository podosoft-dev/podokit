import type { ObjectData, ObjectInfo, ObjectStore } from "./contracts";

export const DEFAULT_MAX_OBJECT_BYTES = 16 * 1024 * 1024;

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
