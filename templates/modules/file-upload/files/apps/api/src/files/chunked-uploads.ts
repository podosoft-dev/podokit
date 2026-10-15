import type { SQL } from "bun";
import { AppException } from "@podosoft/podokit-contracts";
import {
  MultipartUploadError,
  type CompletedPart,
  type DatabaseProviderName,
  type ObjectInfo,
  type ObjectStore,
} from "@podosoft/podokit-runtime";
import { expectedPartSize, partLayout, type UploadConfig } from "./upload-config";
import { uploadKey } from "./upload-keys";

export type UploadStatus = "open" | "completing" | "completed" | "aborted";

export interface NewUpload {
  filename: string;
  size: number;
  contentType?: string;
}

export interface CreatedUpload {
  id: string;
  partSize: number;
  partCount: number;
  expiresAt: string;
}

export interface UploadView extends CreatedUpload {
  status: UploadStatus;
  filename: string;
  contentType: string | null;
  size: number;
  /** Part numbers stored so far, ascending. Resume by sending the others. */
  receivedParts: number[];
  /** The object key, once the upload has completed. */
  key?: string;
}

export interface StoredPart {
  partNumber: number;
  size: number;
}

export interface CompletedUpload {
  id: string;
  status: "completed";
  key: string;
  size: number;
  contentType: string | null;
  url: string;
}

export interface SweepResult {
  /** Open uploads past their expiry that were aborted. */
  expired: number;
  /** Aborted uploads whose storage cleanup was retried successfully. */
  released: number;
  /** Uploads left completing by a stopped replica that were settled. */
  recovered: number;
  /** Finished upload records deleted after their retention. */
  deleted: number;
}

export interface ChunkedUploadLogger {
  warn(details: Record<string, unknown>, message: string): void;
}

export interface ChunkedUploadsOptions {
  sql: SQL;
  dialect: DatabaseProviderName;
  config: UploadConfig;
  /** Resolved on use, so an object store replaced after configuration is honored. */
  storage: () => ObjectStore;
  logger?: ChunkedUploadLogger;
  now?: () => number;
}

/** Thrown into a part body that is shorter or longer than its Content-Length promised. */
class PartLengthError extends Error {}

interface SessionRow {
  id: string;
  ownerId: string | null;
  objectKey: string;
  multipartUploadId: string | null;
  filename: string;
  contentType: string | null;
  size: number | string;
  partSize: number | string;
  partCount: number | string;
  status: UploadStatus;
  expiresAt: Date | string;
}

interface Session {
  id: string;
  ownerId: string | null;
  objectKey: string;
  multipartUploadId: string | null;
  filename: string;
  contentType: string | null;
  size: number;
  partSize: number;
  partCount: number;
  status: UploadStatus;
  expiresAt: number;
}

interface ClaimedRow {
  id: string;
  objectKey: string;
  multipartUploadId: string | null;
  size: number | string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** How long one replica may hold an upload in "completing" before the sweep settles it. */
export const COMPLETE_LEASE_MS = 15 * 60 * 1000;
const SWEEP_BATCH = 100;
const SWEEP_MAX_BATCHES = 10;
const MAX_LISTED_PARTS = 20;

function iso(time: number): string {
  return new Date(time).toISOString();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function session(row: SessionRow): Session {
  return {
    id: row.id,
    ownerId: row.ownerId,
    objectKey: row.objectKey,
    multipartUploadId: row.multipartUploadId,
    filename: row.filename,
    contentType: row.contentType,
    // PostgreSQL returns bigint columns as strings.
    size: Number(row.size),
    partSize: Number(row.partSize),
    partCount: Number(row.partCount),
    status: row.status,
    expiresAt: new Date(row.expiresAt).getTime(),
  };
}

function notFound(text = "Upload not found"): AppException {
  return new AppException("UPLOAD_NOT_FOUND", text, 404);
}

/** Passes the body through while counting it, and fails it unless it holds exactly `expected` bytes. */
function exactLength(body: ReadableStream<Uint8Array>, expected: number): ReadableStream<Uint8Array> {
  let received = 0;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller): void {
      received += chunk.byteLength;
      if (received > expected) throw new PartLengthError("The part body is longer than its Content-Length");
      controller.enqueue(chunk);
    },
    flush(): void {
      if (received !== expected) throw new PartLengthError("The part body ended before its Content-Length");
    },
  }));
}

function listed(numbers: number[]): string {
  const shown = numbers.slice(0, MAX_LISTED_PARTS).join(", ");
  return numbers.length > MAX_LISTED_PARTS ? `${shown}, and ${numbers.length - MAX_LISTED_PARTS} more` : shown;
}

/**
 * Resumable uploads assembled from parts. Every state lives in the database and
 * every transition is a conditional UPDATE, so any API replica can serve any
 * request of an upload, and only one replica completes or aborts it.
 *
 * States: open (accepting parts) -> completing (one replica is assembling the
 * object) -> completed; open -> aborted by the owner or by the expiry sweep.
 * `multipartUploadId` stays set until the storage upload is completed or
 * aborted, so the sweep can retry a storage abort that failed.
 */
export class ChunkedUploads {
  private readonly sql: SQL;
  private readonly dialect: DatabaseProviderName;
  private readonly config: UploadConfig;
  private readonly storage: () => ObjectStore;
  private readonly logger?: ChunkedUploadLogger;
  private readonly now: () => number;
  private sweepTimer?: ReturnType<typeof setTimeout>;
  private sweeping?: Promise<void>;
  private closed = false;

  constructor(options: ChunkedUploadsOptions) {
    this.sql = options.sql;
    this.dialect = options.dialect;
    this.config = options.config;
    this.storage = options.storage;
    this.logger = options.logger;
    this.now = options.now ?? Date.now;
  }

  get settings(): UploadConfig {
    return this.config;
  }

  async create(owner: string | undefined, input: NewUpload): Promise<CreatedUpload> {
    if (!Number.isSafeInteger(input.size) || input.size < 1) {
      throw new AppException("UPLOAD_SIZE_INVALID", "The upload size must be a positive whole number of bytes", 400);
    }
    if (input.size > this.config.maxBytes) {
      throw new AppException(
        "UPLOAD_TOO_LARGE",
        `The upload exceeds the ${this.config.maxBytes}-byte limit`,
        413,
      );
    }
    const layout = partLayout(input.size, this.config.partBytes);
    const id = crypto.randomUUID();
    const key = uploadKey(owner, input.filename, id);
    const storage = this.storage();
    const { uploadId } = await storage.createMultipartUpload(
      key,
      input.contentType ? { contentType: input.contentType } : {},
    );
    const now = this.now();
    const expiresAt = iso(now + this.config.sessionTtlSeconds * 1000);
    try {
      await this.sql`
        INSERT INTO "file_upload_sessions" (
          "id", "ownerId", "objectKey", "multipartUploadId", "filename", "contentType",
          "size", "partSize", "partCount", "status", "expiresAt", "createdAt", "updatedAt"
        ) VALUES (
          ${id}, ${owner ?? null}, ${key}, ${uploadId}, ${input.filename}, ${input.contentType ?? null},
          ${input.size}, ${layout.partSize}, ${layout.partCount}, 'open', ${expiresAt}, ${iso(now)}, ${iso(now)}
        )
      `;
    } catch (error) {
      await storage.abortMultipartUpload(key, uploadId).catch(() => undefined);
      throw error;
    }
    return { id, partSize: layout.partSize, partCount: layout.partCount, expiresAt };
  }

  async status(owner: string | undefined, id: string): Promise<UploadView> {
    const upload = await this.load(owner, id);
    const parts = await this.parts(upload.id);
    return {
      id: upload.id,
      status: upload.status,
      filename: upload.filename,
      contentType: upload.contentType,
      size: upload.size,
      partSize: upload.partSize,
      partCount: upload.partCount,
      receivedParts: parts.map((part) => part.partNumber),
      expiresAt: iso(upload.expiresAt),
      ...(upload.status === "completed" ? { key: upload.objectKey } : {}),
    };
  }

  /**
   * Streams one part to storage. `contentLength` must equal the part's expected
   * size; sending a part again replaces it.
   */
  async putPart(
    owner: string | undefined,
    id: string,
    partNumber: number,
    contentLength: number | null,
    body: ReadableStream<Uint8Array> | null,
  ): Promise<StoredPart> {
    const upload = await this.load(owner, id);
    const uploadId = this.writable(upload);
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > upload.partCount) {
      throw new AppException(
        "UPLOAD_PART_OUT_OF_RANGE",
        `Part numbers for this upload run from 1 to ${upload.partCount}`,
        400,
      );
    }
    const expected = expectedPartSize(upload.size, upload, partNumber);
    if (contentLength === null) {
      throw new AppException("UPLOAD_LENGTH_REQUIRED", "Send the part with a Content-Length header", 411);
    }
    const mismatch = new AppException(
      "UPLOAD_PART_SIZE_MISMATCH",
      `Part ${partNumber} must be exactly ${expected} bytes`,
      400,
    );
    if (contentLength !== expected || body === null) throw mismatch;

    try {
      const stored = await this.storage().uploadPart(
        upload.objectKey,
        uploadId,
        partNumber,
        exactLength(body, expected),
      );
      if (stored.size !== expected) throw mismatch;
      const now = this.now();
      const recorded = await this.sql.begin(async (tx) => {
        // The session row is updated first: on PostgreSQL its row lock orders
        // this part against a concurrent complete, which claims the same row.
        const touched = await tx<Array<{ id: string }>>`
          UPDATE "file_upload_sessions"
          SET "expiresAt" = ${iso(now + this.config.sessionTtlSeconds * 1000)}, "updatedAt" = ${iso(now)}
          WHERE "id" = ${upload.id} AND "status" = 'open' AND "expiresAt" > ${iso(now)}
          RETURNING "id"
        `;
        if (touched.length === 0) return false;
        await tx`
          INSERT INTO "file_upload_parts" ("sessionId", "partNumber", "etag", "size", "updatedAt")
          VALUES (${upload.id}, ${partNumber}, ${stored.etag}, ${stored.size}, ${iso(now)})
          ON CONFLICT ("sessionId", "partNumber") DO UPDATE
          SET "etag" = excluded."etag", "size" = excluded."size", "updatedAt" = excluded."updatedAt"
        `;
        return true;
      });
      if (!recorded) {
        this.writable(await this.load(owner, id));
        throw new AppException("UPLOAD_CONFLICT", "The upload changed while the part was stored", 409);
      }
      return { partNumber, size: expected };
    } catch (error) {
      if (error instanceof PartLengthError) throw mismatch;
      if (error instanceof MultipartUploadError && error.code === "UPLOAD_NOT_FOUND") {
        throw await this.lost(owner, upload);
      }
      throw error;
    }
  }

  /**
   * Joins the parts into the object. Exactly one request wins the open ->
   * completing transition; a repeated call after success returns the same result.
   */
  async complete(owner: string | undefined, id: string): Promise<CompletedUpload> {
    const upload = await this.load(owner, id);
    if (upload.status === "completed") return this.completedResult(upload);
    this.writable(upload);
    this.assertAllParts(upload, await this.parts(upload.id));

    const now = this.now();
    const claimed = await this.sql<Array<{ id: string }>>`
      UPDATE "file_upload_sessions"
      SET "status" = 'completing', "expiresAt" = ${iso(now + COMPLETE_LEASE_MS)}, "updatedAt" = ${iso(now)}
      WHERE "id" = ${upload.id} AND "status" = 'open' AND "expiresAt" > ${iso(now)}
      RETURNING "id"
    `;
    if (claimed.length === 0) {
      const current = await this.load(owner, id);
      if (current.status === "completed") return this.completedResult(current);
      this.writable(current);
      throw new AppException("UPLOAD_COMPLETING", "The upload is being completed", 409);
    }

    // A part is recorded only while the upload is open, so this list is final.
    const parts = await this.parts(upload.id);
    try {
      this.assertAllParts(upload, parts);
    } catch (error) {
      await this.reopen(upload.id);
      throw error;
    }
    const info = await this.assemble(upload, parts);
    const finished = this.now();
    await this.sql`
      UPDATE "file_upload_sessions"
      SET "status" = 'completed', "multipartUploadId" = NULL,
          "expiresAt" = ${iso(finished + this.config.sessionTtlSeconds * 1000)}, "updatedAt" = ${iso(finished)}
      WHERE "id" = ${upload.id} AND "status" = 'completing'
    `;
    return this.completedResult({ ...upload, size: info.size });
  }

  /** Cancels an open upload and discards its parts. Aborting an aborted upload succeeds. */
  async abort(owner: string | undefined, id: string): Promise<void> {
    let upload = await this.load(owner, id);
    if (upload.status === "open") {
      const now = this.now();
      const claimed = await this.sql<Array<{ id: string }>>`
        UPDATE "file_upload_sessions"
        SET "status" = 'aborted', "expiresAt" = ${iso(now + this.config.sessionTtlSeconds * 1000)},
            "updatedAt" = ${iso(now)}
        WHERE "id" = ${upload.id} AND "status" = 'open'
        RETURNING "id"
      `;
      upload = claimed.length > 0 ? { ...upload, status: "aborted" } : await this.load(owner, id);
    }
    if (upload.status === "completed") {
      throw new AppException("UPLOAD_COMPLETED", "The upload has already completed", 409);
    }
    if (upload.status !== "aborted") {
      throw new AppException("UPLOAD_COMPLETING", "The upload is being completed", 409);
    }
    if (upload.multipartUploadId !== null) {
      await this.release(upload.id, upload.objectKey, upload.multipartUploadId);
    }
  }

  /**
   * Aborts expired uploads, retries storage aborts that failed, settles uploads
   * a stopped replica left completing, and deletes finished records once their
   * retention ends. Each row is claimed with a conditional UPDATE first, so
   * replicas sweeping at the same time never handle the same upload.
   */
  async sweep(): Promise<SweepResult> {
    const result: SweepResult = { expired: 0, released: 0, recovered: 0, deleted: 0 };
    const now = this.now();
    const retainUntil = iso(now + this.config.sessionTtlSeconds * 1000);
    const retryBefore = iso(now - Math.max(this.config.sweepIntervalSeconds, 60) * 1000);
    const sql = this.sql;
    const skipLocked = this.dialect === "postgres" ? sql`FOR UPDATE SKIP LOCKED` : sql``;

    for (let batch = 0; batch < SWEEP_MAX_BATCHES && !this.closed; batch++) {
      const rows = await sql<ClaimedRow[]>`
        UPDATE "file_upload_sessions"
        SET "status" = 'aborted', "expiresAt" = ${retainUntil}, "updatedAt" = ${iso(now)}
        WHERE "id" IN (
          SELECT "id" FROM "file_upload_sessions"
          WHERE "status" = 'open' AND "expiresAt" < ${iso(now)}
          ORDER BY "expiresAt" LIMIT ${SWEEP_BATCH} ${skipLocked}
        ) AND "status" = 'open' AND "expiresAt" < ${iso(now)}
        RETURNING "id", "objectKey", "multipartUploadId", "size"
      `;
      for (const row of rows) {
        if (row.multipartUploadId !== null) await this.release(row.id, row.objectKey, row.multipartUploadId);
      }
      result.expired += rows.length;
      if (rows.length < SWEEP_BATCH) break;
    }

    for (let batch = 0; batch < SWEEP_MAX_BATCHES && !this.closed; batch++) {
      const rows = await sql<ClaimedRow[]>`
        UPDATE "file_upload_sessions" SET "updatedAt" = ${iso(now)}
        WHERE "id" IN (
          SELECT "id" FROM "file_upload_sessions"
          WHERE "status" = 'aborted' AND "multipartUploadId" IS NOT NULL AND "updatedAt" < ${retryBefore}
          ORDER BY "updatedAt" LIMIT ${SWEEP_BATCH} ${skipLocked}
        ) AND "status" = 'aborted' AND "multipartUploadId" IS NOT NULL AND "updatedAt" < ${retryBefore}
        RETURNING "id", "objectKey", "multipartUploadId", "size"
      `;
      for (const row of rows) {
        if (row.multipartUploadId !== null && await this.release(row.id, row.objectKey, row.multipartUploadId)) {
          result.released += 1;
        }
      }
      if (rows.length < SWEEP_BATCH) break;
    }

    for (let batch = 0; batch < SWEEP_MAX_BATCHES && !this.closed; batch++) {
      const rows = await sql<ClaimedRow[]>`
        UPDATE "file_upload_sessions"
        SET "expiresAt" = ${iso(now + COMPLETE_LEASE_MS)}, "updatedAt" = ${iso(now)}
        WHERE "id" IN (
          SELECT "id" FROM "file_upload_sessions"
          WHERE "status" = 'completing' AND "expiresAt" < ${iso(now)}
          ORDER BY "expiresAt" LIMIT ${SWEEP_BATCH} ${skipLocked}
        ) AND "status" = 'completing' AND "expiresAt" < ${iso(now)}
        RETURNING "id", "objectKey", "multipartUploadId", "size"
      `;
      for (const row of rows) {
        await this.settle(row, retainUntil);
        result.recovered += 1;
      }
      if (rows.length < SWEEP_BATCH) break;
    }

    for (let batch = 0; batch < SWEEP_MAX_BATCHES && !this.closed; batch++) {
      // Parts are removed with their session by the foreign key.
      const rows = await sql<Array<{ id: string }>>`
        DELETE FROM "file_upload_sessions" WHERE "id" IN (
          SELECT "id" FROM "file_upload_sessions"
          WHERE "status" IN ('completed', 'aborted') AND "multipartUploadId" IS NULL AND "expiresAt" < ${iso(now)}
          ORDER BY "expiresAt" LIMIT ${SWEEP_BATCH}
        )
        RETURNING "id"
      `;
      result.deleted += rows.length;
      if (rows.length < SWEEP_BATCH) break;
    }
    return result;
  }

  /** Starts the periodic sweep unless FILE_UPLOAD_SWEEP_INTERVAL is 0. */
  start(): void {
    this.closed = false;
    if (this.config.sweepIntervalSeconds > 0 && !this.sweepTimer && !this.sweeping) {
      this.scheduleSweep(this.config.sweepIntervalSeconds * 1000);
    }
  }

  /** Stops the sweep and waits for a running one to finish its current batch. */
  async close(): Promise<void> {
    this.closed = true;
    if (this.sweepTimer) clearTimeout(this.sweepTimer);
    this.sweepTimer = undefined;
    await this.sweeping;
  }

  private scheduleSweep(delayMs: number): void {
    this.sweepTimer = setTimeout(() => {
      this.sweepTimer = undefined;
      this.sweeping = this.sweep()
        .then(() => undefined, (error: unknown) => {
          this.logger?.warn({ error: message(error) }, "Upload sweep failed");
        })
        .finally(() => {
          this.sweeping = undefined;
          if (!this.closed) this.scheduleSweep(this.config.sweepIntervalSeconds * 1000);
        });
    }, delayMs);
    this.sweepTimer.unref?.();
  }

  /** Owners only: another caller's upload is reported as missing, not forbidden. */
  private async load(owner: string | undefined, id: string): Promise<Session> {
    if (!UUID.test(id)) throw notFound();
    const rows = await this.sql<SessionRow[]>`
      SELECT "id", "ownerId", "objectKey", "multipartUploadId", "filename", "contentType",
             "size", "partSize", "partCount", "status", "expiresAt"
      FROM "file_upload_sessions" WHERE "id" = ${id}
    `;
    const row = rows[0];
    if (!row || (row.ownerId ?? undefined) !== owner) throw notFound();
    return session(row);
  }

  private async parts(id: string): Promise<CompletedPart[]> {
    const rows = await this.sql<Array<{ partNumber: number | string; etag: string }>>`
      SELECT "partNumber", "etag" FROM "file_upload_parts"
      WHERE "sessionId" = ${id} ORDER BY "partNumber"
    `;
    return rows.map((row) => ({ partNumber: Number(row.partNumber), etag: row.etag }));
  }

  /** Throws unless the upload accepts parts; returns its storage upload id. */
  private writable(upload: Session): string {
    if (upload.status === "completed") {
      throw new AppException("UPLOAD_COMPLETED", "The upload has already completed", 409);
    }
    if (upload.status === "completing") {
      throw new AppException("UPLOAD_COMPLETING", "The upload is being completed", 409);
    }
    if (upload.status === "aborted" || upload.multipartUploadId === null) {
      throw new AppException("UPLOAD_ABORTED", "The upload was cancelled or expired; start a new one", 410);
    }
    if (upload.expiresAt <= this.now()) {
      throw new AppException("UPLOAD_EXPIRED", "The upload expired; start a new one", 410);
    }
    return upload.multipartUploadId;
  }

  private assertAllParts(upload: Session, parts: CompletedPart[]): void {
    const received = new Set(parts.map((part) => part.partNumber));
    const missing: number[] = [];
    for (let number = 1; number <= upload.partCount; number++) {
      if (!received.has(number)) missing.push(number);
    }
    if (missing.length > 0) {
      throw new AppException("UPLOAD_INCOMPLETE", `Parts ${listed(missing)} have not been uploaded`, 409);
    }
  }

  /** Completes the storage upload for a session this request holds in "completing". */
  private async assemble(upload: Session, parts: CompletedPart[]): Promise<ObjectInfo> {
    const storage = this.storage();
    try {
      if (upload.multipartUploadId === null) throw new MultipartUploadError("UPLOAD_NOT_FOUND", "No storage upload");
      return await storage.completeMultipartUpload(upload.objectKey, upload.multipartUploadId, parts);
    } catch (error) {
      if (error instanceof MultipartUploadError && error.code === "UPLOAD_NOT_FOUND") {
        // A complete whose response was lost has already put the object in place.
        const existing = await storage.stat(upload.objectKey);
        if (existing && existing.size === upload.size) return existing;
        await this.markAborted(upload.id, "completing");
        throw notFound("The upload no longer exists in storage; start a new one");
      }
      await this.reopen(upload.id);
      if (error instanceof MultipartUploadError) {
        throw error.code === "INVALID_PART"
          ? new AppException("UPLOAD_INVALID_PART", "A stored part changed or is missing; upload the parts again", 409)
          : new AppException("UPLOAD_PART_TOO_SMALL", error.message, 409);
      }
      throw error;
    }
  }

  private async completedResult(upload: Session): Promise<CompletedUpload> {
    return {
      id: upload.id,
      status: "completed",
      key: upload.objectKey,
      size: upload.size,
      contentType: upload.contentType,
      url: await this.storage().getDownloadUrl(upload.objectKey),
    };
  }

  private async reopen(id: string): Promise<void> {
    const now = this.now();
    await this.sql`
      UPDATE "file_upload_sessions"
      SET "status" = 'open', "expiresAt" = ${iso(now + this.config.sessionTtlSeconds * 1000)}, "updatedAt" = ${iso(now)}
      WHERE "id" = ${id} AND "status" = 'completing'
    `;
  }

  private async markAborted(id: string, from: UploadStatus): Promise<boolean> {
    const now = this.now();
    const rows = await this.sql<Array<{ id: string }>>`
      UPDATE "file_upload_sessions"
      SET "status" = 'aborted', "multipartUploadId" = NULL,
          "expiresAt" = ${iso(now + this.config.sessionTtlSeconds * 1000)}, "updatedAt" = ${iso(now)}
      WHERE "id" = ${id} AND "status" = ${from}
      RETURNING "id"
    `;
    return rows.length > 0;
  }

  /** Storage no longer knows an upload the session still holds open. */
  private async lost(owner: string | undefined, upload: Session): Promise<AppException> {
    if (await this.markAborted(upload.id, "open")) {
      return notFound("The upload no longer exists in storage; start a new one");
    }
    // Another request finished or cancelled it meanwhile; report that state.
    try {
      this.writable(await this.load(owner, upload.id));
    } catch (error) {
      if (error instanceof AppException) return error;
      throw error;
    }
    return notFound("The upload no longer exists in storage; start a new one");
  }

  /** Aborts the storage upload and forgets its id. A failure is retried by the sweep. */
  private async release(id: string, key: string, uploadId: string): Promise<boolean> {
    try {
      await this.storage().abortMultipartUpload(key, uploadId);
    } catch (error) {
      this.logger?.warn({ uploadId: id, error: message(error) }, "Abort of a storage multipart upload failed");
      return false;
    }
    await this.sql`
      UPDATE "file_upload_sessions" SET "multipartUploadId" = NULL
      WHERE "id" = ${id} AND "status" = 'aborted'
    `;
    return true;
  }

  /** Settles an upload whose completing replica stopped before recording the result. */
  private async settle(row: ClaimedRow, retainUntil: string): Promise<void> {
    const existing = await this.storage().stat(row.objectKey).catch(() => null);
    if (existing && existing.size === Number(row.size)) {
      await this.sql`
        UPDATE "file_upload_sessions"
        SET "status" = 'completed', "multipartUploadId" = NULL, "expiresAt" = ${retainUntil},
            "updatedAt" = ${iso(this.now())}
        WHERE "id" = ${row.id} AND "status" = 'completing'
      `;
      return;
    }
    const rows = await this.sql<Array<{ id: string }>>`
      UPDATE "file_upload_sessions"
      SET "status" = 'aborted', "expiresAt" = ${retainUntil}, "updatedAt" = ${iso(this.now())}
      WHERE "id" = ${row.id} AND "status" = 'completing'
      RETURNING "id"
    `;
    if (rows.length > 0 && row.multipartUploadId !== null) {
      await this.release(row.id, row.objectKey, row.multipartUploadId);
    }
  }
}
