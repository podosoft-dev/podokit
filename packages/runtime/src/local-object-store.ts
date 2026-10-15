import { constants, type Dirent, type Stats } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type {
  CompletedPart,
  CreateMultipartUploadOptions,
  DownloadUrlOptions,
  ListObjectsOptions,
  MultipartUpload,
  ObjectBody,
  ObjectData,
  ObjectInfo,
  ObjectPage,
  ObjectStore,
  PutObjectOptions,
  StoredObject,
  UploadedPart,
} from "./contracts";
import {
  assertPartNumber,
  MIN_MULTIPART_PART_BYTES,
  MultipartUploadError,
  normalizeCompletedParts,
  objectBodyChunks,
  objectListLimit,
} from "./object-storage";

interface ObjectMetadata {
  contentType?: string;
}

interface MultipartManifest {
  key: string;
  contentType?: string;
}

const CHUNK_BYTES = 64 * 1024;
const COPY_CHUNK_BYTES = 1024 * 1024;
const TEMPORARY_FILE = /^\.podokit-.+\.tmp$/;
const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UPLOAD_MANIFEST = "upload.json";
const DEFAULT_MULTIPART_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MULTIPART_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export interface LocalObjectStoreOptions {
  rootDirectory: string;
  publicBaseUrl?: string;
  /**
   * Multipart uploads without activity for this long are removed. Defaults to
   * 24 hours. Checked at most hourly when an upload starts, and on demand with
   * `abortStaleMultipartUploads()`.
   */
  multipartMaxAgeMs?: number;
}

function normalizeKey(key: string): string {
  if (key.length === 0 || key.includes("\0") || isAbsolute(key) || /^[A-Za-z]:/.test(key)) {
    throw new Error("Object key must be a safe relative path");
  }
  const segments = key.replaceAll("\\", "/").split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("Object key must be a safe relative path");
  }
  if (segments[0] === ".podokit") throw new Error("Object key uses a reserved path");
  return segments.join("/");
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function isMissing(error: unknown): boolean {
  const code = errorCode(error);
  return code === "ENOENT" || code === "ENOTDIR";
}

function uploadNotFound(uploadId: string): MultipartUploadError {
  return new MultipartUploadError("UPLOAD_NOT_FOUND", `Multipart upload ${uploadId} does not exist`);
}

function partFileName(partNumber: number): string {
  return `${String(partNumber).padStart(5, "0")}.part`;
}

/** Writes a body to an open file and returns the number of bytes written. */
async function writeBody(handle: FileHandle, body: ObjectBody): Promise<number> {
  let size = 0;
  for await (const chunk of objectBodyChunks(body)) {
    size += chunk.byteLength;
    await handle.write(chunk);
  }
  return size;
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs;
}

/**
 * Puts replace files by rename, never in place, so the inode, size, and
 * modification time identify one version of the content.
 */
function entityTag(details: Stats): string {
  const modified = Math.floor(details.mtimeMs * 1000);
  return `"${details.ino.toString(16)}-${details.size.toString(16)}-${modified.toString(16)}"`;
}

/**
 * Opens the file on the first read and refuses to stream a different file than
 * the one described, which also stops a swapped-in symbolic link.
 */
function fileBody(path: string, expected: Stats): ReadableStream<Uint8Array> {
  let handle: FileHandle | undefined;
  let position = 0;
  const close = async (): Promise<void> => {
    const current = handle;
    handle = undefined;
    await current?.close();
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller): Promise<void> {
      try {
        if (!handle) {
          handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
          if (!sameFile(await handle.stat(), expected)) {
            throw new Error("Object changed while it was being read");
          }
        }
        if (position < expected.size) {
          const chunk = new Uint8Array(Math.min(CHUNK_BYTES, expected.size - position));
          const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, position);
          if (bytesRead === 0) throw new Error("Object changed while it was being read");
          position += bytesRead;
          controller.enqueue(bytesRead === chunk.byteLength ? chunk : chunk.subarray(0, bytesRead));
        }
        if (position === expected.size) {
          await close();
          controller.close();
        }
      } catch (error) {
        await close().catch(() => undefined);
        controller.error(error);
      }
    },
    async cancel(): Promise<void> {
      await close();
    },
  }, { highWaterMark: 0 });
}

function encodeCursor(key: string): string {
  return Buffer.from(key, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): string {
  const key = Buffer.from(cursor, "base64url").toString("utf8");
  if (key.length === 0) throw new Error("Object list cursor is invalid");
  return key;
}

/** Splits a key prefix into its directory part ("" or ending in "/") and the rest. */
function splitPrefix(prefix: string): { directory: string; name: string } {
  if (prefix.includes("\0") || isAbsolute(prefix) || /^[A-Za-z]:/.test(prefix)) {
    throw new Error("Object key prefix must be a safe relative path");
  }
  const normalized = prefix.replaceAll("\\", "/");
  const slash = normalized.lastIndexOf("/");
  const directory = normalized.slice(0, slash + 1);
  const segments = directory === "" ? [] : directory.slice(0, -1).split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("Object key prefix must be a safe relative path");
  }
  return { directory, name: normalized.slice(slash + 1) };
}

interface ListEntry {
  /** The object key, or the key prefix of a directory, ending in "/". */
  key: string;
  directory: boolean;
}

export class LocalObjectStore implements ObjectStore {
  private readonly rootDirectory: string;
  private readonly publicBaseUrl: string;
  private readonly multipartMaxAgeMs: number;
  private ready: Promise<string> | undefined;
  private lastMultipartSweep = 0;

  constructor(options: LocalObjectStoreOptions) {
    if (!isAbsolute(options.rootDirectory)) {
      throw new Error("rootDirectory must be absolute");
    }
    const maxAge = options.multipartMaxAgeMs ?? DEFAULT_MULTIPART_MAX_AGE_MS;
    if (!Number.isFinite(maxAge) || maxAge <= 0) {
      throw new RangeError("multipartMaxAgeMs must be a positive number");
    }
    this.rootDirectory = resolve(options.rootDirectory);
    this.publicBaseUrl = (options.publicBaseUrl ?? "/files/content").replace(/\/$/, "");
    this.multipartMaxAgeMs = maxAge;
  }

  async put(key: string, body: ObjectBody, options: PutObjectOptions = {}): Promise<StoredObject> {
    const normalized = normalizeKey(key);
    const path = await this.safePath(normalized, true);
    const temporary = join(dirname(path), `.podokit-${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    let size = 0;
    try {
      size = await writeBody(handle, body);
      await handle.sync();
      await handle.close();
      await rename(temporary, path);
      await this.writeMetadata(normalized, options);
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    return { key: normalized, size, ...options };
  }

  async get(key: string): Promise<ObjectData | null> {
    const found = await this.find(key);
    if (!found) return null;
    return { ...found.info, body: fileBody(found.path, found.details) };
  }

  async stat(key: string): Promise<ObjectInfo | null> {
    return (await this.find(key))?.info ?? null;
  }

  async list(prefix: string, options: ListObjectsOptions = {}): Promise<ObjectPage> {
    const limit = objectListLimit(options);
    const after = options.cursor === undefined ? undefined : decodeCursor(options.cursor);
    const { directory, name } = splitPrefix(prefix);
    const keys: string[] = [];
    for await (const key of this.walk(directory, name, after)) {
      if (keys.length === limit) return { keys, nextCursor: encodeCursor(keys[keys.length - 1] ?? "") };
      keys.push(key);
    }
    return { keys };
  }

  async exists(key: string): Promise<boolean> {
    return (await this.find(key)) !== null;
  }

  async delete(key: string): Promise<void> {
    const normalized = normalizeKey(key);
    const path = await this.safePath(normalized, false);
    await unlink(path).catch((error: unknown) => {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    });
    await unlink(await this.metadataPath(normalized)).catch((error: unknown) => {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    });
  }

  getDownloadUrl(key: string, _options: DownloadUrlOptions = {}): Promise<string> {
    const normalized = normalizeKey(key);
    const encoded = normalized.split("/").map(encodeURIComponent).join("/");
    return Promise.resolve(`${this.publicBaseUrl}/${encoded}`);
  }

  async createMultipartUpload(
    key: string,
    options: CreateMultipartUploadOptions = {},
  ): Promise<MultipartUpload> {
    const normalized = normalizeKey(key);
    await this.sweepStaleMultipartUploads();
    const uploadId = randomUUID();
    const directory = join(await this.multipartRoot(), uploadId);
    await mkdir(directory, { mode: 0o700 });
    const manifest: MultipartManifest = {
      key: normalized,
      ...(options.contentType ? { contentType: options.contentType } : {}),
    };
    await writeFile(join(directory, UPLOAD_MANIFEST), `${JSON.stringify(manifest)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    return { uploadId };
  }

  async uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    body: ObjectBody,
  ): Promise<UploadedPart> {
    const normalized = normalizeKey(key);
    assertPartNumber(partNumber);
    const { directory } = await this.openUpload(normalized, uploadId);
    const temporary = join(directory, `.podokit-${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try {
      const size = await writeBody(handle, body);
      await handle.sync();
      // A rename keeps the inode and modification time, so the tag taken here
      // still identifies this content once the part is in place.
      const etag = entityTag(await handle.stat());
      await handle.close();
      await rename(temporary, join(directory, partFileName(partNumber))).catch((error: unknown) => {
        throw isMissing(error) ? uploadNotFound(uploadId) : error;
      });
      return { etag, size };
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: readonly CompletedPart[],
  ): Promise<ObjectInfo> {
    const normalized = normalizeKey(key);
    const ordered = normalizeCompletedParts(parts);
    const { directory, manifest } = await this.openUpload(normalized, uploadId);
    const files: Array<{ path: string; details: Stats }> = [];
    for (const [index, part] of ordered.entries()) {
      const path = join(directory, partFileName(part.partNumber));
      const details = await lstat(path).catch((error: unknown) => {
        if (isMissing(error)) return undefined;
        throw error;
      });
      if (!details?.isFile() || entityTag(details) !== part.etag) {
        throw new MultipartUploadError(
          "INVALID_PART",
          `Part ${part.partNumber} was not uploaded or has changed`,
        );
      }
      if (index < ordered.length - 1 && details.size < MIN_MULTIPART_PART_BYTES) {
        throw new MultipartUploadError(
          "PART_TOO_SMALL",
          `Part ${part.partNumber} has ${details.size} bytes; every part but the last needs ${MIN_MULTIPART_PART_BYTES}`,
        );
      }
      files.push({ path, details });
    }

    const path = await this.safePath(normalized, true);
    const temporary = join(dirname(path), `.podokit-${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    let details: Stats;
    try {
      const buffer = new Uint8Array(COPY_CHUNK_BYTES);
      for (const file of files) await this.appendPart(handle, file.path, file.details, buffer);
      await handle.sync();
      details = await handle.stat();
      await handle.close();
      await rename(temporary, path);
      await this.writeMetadata(normalized, manifest.contentType ? { contentType: manifest.contentType } : {});
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    await rm(directory, { recursive: true, force: true });
    return {
      key: normalized,
      size: details.size,
      ...(manifest.contentType ? { contentType: manifest.contentType } : {}),
      etag: entityTag(details),
      lastModified: details.mtime,
    };
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    const normalized = normalizeKey(key);
    let directory: string;
    try {
      ({ directory } = await this.openUpload(normalized, uploadId));
    } catch (error) {
      if (error instanceof MultipartUploadError) return;
      throw error;
    }
    await rm(directory, { recursive: true, force: true });
  }

  /**
   * Removes multipart uploads without activity for `maxAgeMs` (the store's
   * `multipartMaxAgeMs` by default) and returns how many were removed.
   */
  async abortStaleMultipartUploads(maxAgeMs = this.multipartMaxAgeMs): Promise<number> {
    const root = await this.multipartRoot();
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !UPLOAD_ID.test(entry.name)) continue;
      const directory = join(root, entry.name);
      const details = await lstat(directory).catch(() => undefined);
      // Adding or replacing a part updates the directory's modification time.
      if (!details || details.mtimeMs > cutoff) continue;
      await rm(directory, { recursive: true, force: true });
      removed += 1;
    }
    return removed;
  }

  close(): void {}

  private async sweepStaleMultipartUploads(): Promise<void> {
    const now = Date.now();
    if (now - this.lastMultipartSweep < Math.min(this.multipartMaxAgeMs, MULTIPART_SWEEP_INTERVAL_MS)) return;
    this.lastMultipartSweep = now;
    // Cleanup is best effort and never fails the upload that triggered it.
    await this.abortStaleMultipartUploads().catch(() => 0);
  }

  private async multipartRoot(): Promise<string> {
    const directory = join(await this.root(), ".podokit", "multipart");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return directory;
  }

  /** Resolves an upload's directory, refusing unknown ids and uploads of another key. */
  private async openUpload(
    key: string,
    uploadId: string,
  ): Promise<{ directory: string; manifest: MultipartManifest }> {
    if (!UPLOAD_ID.test(uploadId)) throw uploadNotFound(uploadId);
    const directory = join(await this.multipartRoot(), uploadId);
    let manifest: MultipartManifest;
    try {
      manifest = JSON.parse(await readFile(join(directory, UPLOAD_MANIFEST), "utf8")) as MultipartManifest;
    } catch (error) {
      if (isMissing(error)) throw uploadNotFound(uploadId);
      throw error;
    }
    if (manifest.key !== key) throw uploadNotFound(uploadId);
    return { directory, manifest };
  }

  /** Copies one part, refusing a part file replaced after it was validated. */
  private async appendPart(
    target: FileHandle,
    path: string,
    expected: Stats,
    buffer: Uint8Array,
  ): Promise<void> {
    const source = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!sameFile(await source.stat(), expected)) {
        throw new MultipartUploadError("INVALID_PART", "A part changed while the upload was completing");
      }
      let position = 0;
      while (position < expected.size) {
        const { bytesRead } = await source.read(buffer, 0, buffer.byteLength, position);
        if (bytesRead === 0) {
          throw new MultipartUploadError("INVALID_PART", "A part changed while the upload was completing");
        }
        await target.write(buffer, 0, bytesRead);
        position += bytesRead;
      }
    } finally {
      await source.close();
    }
  }

  private async find(
    key: string,
  ): Promise<{ path: string; details: Stats; info: ObjectInfo } | null> {
    const normalized = normalizeKey(key);
    let path: string;
    let details: Stats;
    try {
      path = await this.safePath(normalized, false);
      details = await lstat(path);
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    if (!details.isFile()) return null;
    const metadata = await this.readMetadata(normalized);
    return {
      path,
      details,
      info: {
        key: normalized,
        size: details.size,
        ...metadata,
        etag: entityTag(details),
        lastModified: details.mtime,
      },
    };
  }

  /**
   * Yields keys in ascending order, one directory listing at a time. A
   * directory sorts as its name plus "/", which keeps the order of whole keys.
   */
  private async *walk(directory: string, name: string, after: string | undefined): AsyncGenerator<string> {
    const root = await this.root();
    const segments = directory === "" ? [] : directory.slice(0, -1).split("/");
    if (segments[0] === ".podokit") return;
    let path = root;
    for (const segment of segments) {
      path = join(path, segment);
      try {
        const details = await lstat(path);
        if (!details.isDirectory()) return;
      } catch (error) {
        if (isMissing(error)) return;
        throw error;
      }
    }
    let entries: Dirent[];
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    const listed: ListEntry[] = [];
    for (const entry of entries) {
      if (!entry.name.startsWith(name) || (directory === "" && entry.name === ".podokit")) continue;
      if (entry.isDirectory()) listed.push({ key: `${directory}${entry.name}/`, directory: true });
      else if (entry.isFile() && !TEMPORARY_FILE.test(entry.name)) {
        listed.push({ key: `${directory}${entry.name}`, directory: false });
      }
    }
    listed.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
    for (const entry of listed) {
      if (!entry.directory) {
        if (after === undefined || entry.key > after) yield entry.key;
      } else if (after === undefined || entry.key > after || after.startsWith(entry.key)) {
        yield* this.walk(entry.key, "", after);
      }
    }
  }

  /**
   * Prepares the root on first use rather than in the constructor, so a store
   * that is never used cannot leave an unhandled rejection, and a failed
   * attempt is retried by the next call.
   */
  private root(): Promise<string> {
    this.ready ??= this.initialize().catch((error: unknown) => {
      this.ready = undefined;
      throw error;
    });
    return this.ready;
  }

  private async initialize(): Promise<string> {
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    return realpath(this.rootDirectory);
  }

  private async safePath(key: string, createParents: boolean): Promise<string> {
    const root = await this.root();
    const candidate = resolve(root, ...key.split("/"));
    const fromRoot = relative(root, candidate);
    if (fromRoot.startsWith(`..${sep}`) || fromRoot === ".." || isAbsolute(fromRoot)) {
      throw new Error("Object key escapes storage root");
    }
    await this.verifyParents(root, dirname(candidate), createParents);
    return candidate;
  }

  private async verifyParents(root: string, parent: string, create: boolean): Promise<void> {
    const fromRoot = relative(root, parent);
    let current = root;
    for (const segment of fromRoot === "" ? [] : fromRoot.split(sep)) {
      current = join(current, segment);
      try {
        const details = await lstat(current);
        if (details.isSymbolicLink() || !details.isDirectory()) {
          const error = new Error("Object path contains a non-directory or symbolic link");
          // A file where a directory would be means the key does not exist.
          if (!details.isSymbolicLink()) Object.assign(error, { code: "ENOTDIR" });
          throw error;
        }
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        if (!create) throw error;
        await mkdir(current, { mode: 0o700 });
      }
    }
  }

  private metadataName(key: string): string {
    return `${createHash("sha256").update(key).digest("hex")}.json`;
  }

  private async metadataPath(key: string): Promise<string> {
    const root = await this.root();
    const directory = join(root, ".podokit", "metadata");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return join(directory, this.metadataName(key));
  }

  private async writeMetadata(key: string, options: PutObjectOptions): Promise<void> {
    const path = await this.metadataPath(key);
    const metadata: ObjectMetadata = {
      ...(options.contentType ? { contentType: options.contentType } : {}),
    };
    await writeFile(path, `${JSON.stringify(metadata)}\n`, { mode: 0o600 });
  }

  private async readMetadata(key: string): Promise<ObjectMetadata> {
    try {
      const parsed = JSON.parse(await readFile(await this.metadataPath(key), "utf8")) as ObjectMetadata;
      return typeof parsed.contentType === "string" ? { contentType: parsed.contentType } : {};
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
      throw error;
    }
  }
}
