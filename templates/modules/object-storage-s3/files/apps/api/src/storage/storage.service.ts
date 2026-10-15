import { S3Client, type S3Stats } from "bun";
import {
  objectBodyChunks,
  objectListLimit,
  type CompletedPart,
  type ListObjectsOptions,
  type ObjectBody,
  type ObjectData,
  type ObjectInfo,
  type ObjectPage,
  type UploadedPart,
} from "@podosoft/podokit-runtime";
import { ReadinessService } from "../health/readiness.service";
import { S3Multipart } from "./s3-multipart";
import { storageSettings, type StorageSettings } from "./storage.config";

/** Part size for streamed writes. */
export const STREAM_PART_BYTES = 8 * 1024 * 1024;
/** Parts of one streamed write that may be in flight at once. */
const STREAM_QUEUE_SIZE = 2;

function isMissingObject(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "NoSuchKey";
}

function entityTag(etag: string): string {
  return etag.startsWith("\"") || etag.startsWith("W/\"") ? etag : `"${etag}"`;
}

function objectInfo(key: string, stats: S3Stats): ObjectInfo {
  return {
    key,
    size: stats.size,
    ...(stats.type ? { contentType: stats.type } : {}),
    etag: entityTag(stats.etag),
    lastModified: stats.lastModified,
  };
}

/**
 * Downloads on the first read, so an unread body costs no request. Bun's
 * `S3File.stream()` reads ahead without backpressure and would hold the rest of
 * the object for a slow client; a presigned GET through fetch is paced by the
 * socket instead, and If-Match keeps it on the version that was described.
 */
function download(client: S3Client, key: string, etag: string): ReadableStream<Uint8Array> {
  const abort = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  return new ReadableStream<Uint8Array>({
    async pull(controller): Promise<void> {
      if (!reader) {
        const response = await fetch(client.presign(key, { expiresIn: 60 }), {
          headers: { "if-match": etag },
          decompress: false,
          signal: abort.signal,
        });
        if (!response.ok || !response.body) {
          await response.body?.cancel();
          throw new Error(
            response.status === 404 || response.status === 412
              ? `Object ${key} changed while it was being read`
              : `Object ${key} download failed with status ${response.status}`,
          );
        }
        reader = response.body.getReader();
      }
      const next = await reader.read();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    async cancel(reason): Promise<void> {
      abort.abort(reason);
      await reader?.cancel(reason).catch(() => undefined);
    },
  }, { highWaterMark: 0 });
}

function multipartClient(settings: StorageSettings): S3Multipart | undefined {
  if (!settings.accessKeyId || !settings.secretAccessKey) return undefined;
  return new S3Multipart({
    bucket: settings.bucket,
    region: settings.region,
    virtualHostedStyle: settings.virtualHostedStyle,
    ...(settings.endpoint ? { endpoint: settings.endpoint } : {}),
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
      ...(settings.sessionToken ? { sessionToken: settings.sessionToken } : {}),
    },
  });
}

/** S3 needs each part's length before it is sent, so a streamed part is collected first. */
async function partBytes(body: ObjectBody): Promise<Uint8Array | Blob> {
  if (body instanceof Uint8Array || body instanceof Blob) return body;
  if (typeof body === "string") return new TextEncoder().encode(body);
  const chunks: Uint8Array[] = [];
  for await (const chunk of objectBodyChunks(body)) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export class StorageService {
  private readonly client: S3Client;
  private readonly multipartRequests: S3Multipart | undefined;
  private unregisterReadiness?: () => void;

  constructor(readiness: ReadinessService) {
    const settings = storageSettings();
    this.client = new S3Client({
      bucket: settings.bucket,
      region: settings.region,
      virtualHostedStyle: settings.virtualHostedStyle,
      ...(settings.endpoint ? { endpoint: settings.endpoint } : {}),
      ...(settings.accessKeyId ? { accessKeyId: settings.accessKeyId } : {}),
      ...(settings.secretAccessKey ? { secretAccessKey: settings.secretAccessKey } : {}),
      ...(settings.sessionToken ? { sessionToken: settings.sessionToken } : {}),
    });
    this.multipartRequests = multipartClient(settings);
    this.unregisterReadiness = readiness.register("object-storage", async () => {
      await this.client.exists(".podokit-readiness");
    });
  }

  /**
   * Writes an object and resolves with its size. Bytes, strings, and small
   * blobs are sent in one request. Streams, async iterables, and larger blobs
   * (including files) are sent in parts, holding about three parts in memory
   * however large the object is; a source that fails aborts the upload, so no
   * partial object is left behind.
   */
  async put(key: string, body: ObjectBody, contentType?: string): Promise<number> {
    const options = contentType ? { type: contentType } : undefined;
    if (
      typeof body === "string" ||
      body instanceof Uint8Array ||
      (body instanceof Blob && body.size <= STREAM_PART_BYTES)
    ) {
      await this.client.file(key).write(body, options);
      return typeof body === "string" ? Buffer.byteLength(body) : body instanceof Blob ? body.size : body.byteLength;
    }
    // Bun's S3 write reads a whole Blob, file-backed ones included, into memory,
    // and its streaming writer completes rather than aborts when ended with an
    // error, so streamed bodies use explicit multipart requests.
    const parts: CompletedPart[] = [];
    const pending = new Set<Promise<void>>();
    let failure: { error: unknown } | undefined;
    let uploadId: string | undefined;
    let nextPartNumber = 1;
    // Part buffers are reused once their upload finishes, so a long stream
    // allocates at most one buffer per queue slot plus the one being filled.
    const spare: Uint8Array[] = [];
    let part: Uint8Array = new Uint8Array(STREAM_PART_BYTES);
    let filled = 0;
    let size = 0;
    const send = async (buffer: Uint8Array, length: number): Promise<void> => {
      uploadId ??= await this.multipart().create(key, contentType);
      const id = uploadId;
      const partNumber = nextPartNumber++;
      const upload: Promise<void> = this.multipart()
        .uploadPart(key, id, partNumber, buffer.subarray(0, length))
        .then((etag) => { parts.push({ partNumber, etag }); })
        .catch((error: unknown) => { failure ??= { error }; })
        .finally(() => {
          pending.delete(upload);
          spare.push(buffer);
        });
      pending.add(upload);
      while (pending.size >= STREAM_QUEUE_SIZE) await Promise.race(pending);
      if (failure) throw failure.error;
    };
    try {
      for await (const chunk of objectBodyChunks(body)) {
        size += chunk.byteLength;
        for (let offset = 0; offset < chunk.byteLength;) {
          const length = Math.min(chunk.byteLength - offset, STREAM_PART_BYTES - filled);
          part.set(chunk.subarray(offset, offset + length), filled);
          filled += length;
          offset += length;
          if (filled === STREAM_PART_BYTES) {
            await send(part, filled);
            part = spare.pop() ?? new Uint8Array(STREAM_PART_BYTES);
            filled = 0;
          }
        }
      }
      if (uploadId === undefined) {
        await this.client.file(key).write(part.subarray(0, filled), options);
        return size;
      }
      if (filled > 0) await send(part, filled);
      await Promise.all(pending);
      if (failure) throw failure.error;
      await this.multipart().complete(key, uploadId, parts.sort((left, right) => left.partNumber - right.partNumber));
      return size;
    } catch (error) {
      await Promise.allSettled(pending);
      if (uploadId !== undefined) await this.multipart().abort(key, uploadId).catch(() => undefined);
      throw error;
    }
  }

  async createMultipartUpload(key: string, contentType?: string): Promise<string> {
    return this.multipart().create(key, contentType);
  }

  async uploadPart(key: string, uploadId: string, partNumber: number, body: ObjectBody): Promise<UploadedPart> {
    const bytes = await partBytes(body);
    const etag = await this.multipart().uploadPart(key, uploadId, partNumber, bytes);
    return { etag, size: bytes instanceof Blob ? bytes.size : bytes.byteLength };
  }

  async completeMultipartUpload(key: string, uploadId: string, parts: readonly CompletedPart[]): Promise<void> {
    await this.multipart().complete(key, uploadId, parts);
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.multipart().abort(key, uploadId);
  }

  /** Reads a whole object into memory. Use `open()` for anything that can be large. */
  async get(key: string): Promise<Buffer> {
    const bytes = await this.client.file(key).bytes();
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  /** Object metadata, or null when the key does not exist. */
  async stat(key: string): Promise<ObjectInfo | null> {
    try {
      return objectInfo(key, await this.client.file(key).stat());
    } catch (error) {
      if (isMissingObject(error)) return null;
      throw error;
    }
  }

  /**
   * Metadata plus a streamed body, or null when the key does not exist. The
   * metadata request comes first because a missing key would otherwise only
   * fail the stream, after a response has already started.
   */
  async open(key: string): Promise<ObjectData | null> {
    const info = await this.stat(key);
    if (!info) return null;
    return { ...info, body: download(this.client, key, info.etag) };
  }

  /** One page of the keys under `prefix`; the bucket is never listed in full. */
  async list(prefix: string, options: ListObjectsOptions = {}): Promise<ObjectPage> {
    const page = await this.client.list({
      prefix,
      maxKeys: objectListLimit(options),
      ...(options.cursor ? { continuationToken: options.cursor } : {}),
    });
    const keys = (page.contents ?? []).map((object) => object.key);
    return page.isTruncated && page.nextContinuationToken
      ? { keys, nextCursor: page.nextContinuationToken }
      : { keys };
  }

  async exists(key: string): Promise<boolean> {
    return this.client.exists(key);
  }

  presignedGetUrl(key: string, expiresIn = 3600): Promise<string> {
    return Promise.resolve(this.client.presign(key, { expiresIn }));
  }

  async delete(key: string): Promise<void> {
    await this.client.delete(key);
  }

  close(): void {
    this.unregisterReadiness?.();
  }

  private multipart(): S3Multipart {
    if (!this.multipartRequests) {
      throw new Error("Multipart uploads need S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY (or the AWS_* equivalents)");
    }
    return this.multipartRequests;
  }
}
