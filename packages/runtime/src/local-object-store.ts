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
  DownloadUrlOptions,
  ListObjectsOptions,
  ObjectBody,
  ObjectData,
  ObjectInfo,
  ObjectPage,
  ObjectStore,
  PutObjectOptions,
  StoredObject,
} from "./contracts";
import { objectListLimit } from "./object-storage";

interface ObjectMetadata {
  contentType?: string;
}

const CHUNK_BYTES = 64 * 1024;
const TEMPORARY_FILE = /^\.podokit-.+\.tmp$/;

export interface LocalObjectStoreOptions {
  rootDirectory: string;
  publicBaseUrl?: string;
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

async function* objectChunks(body: ObjectBody): AsyncGenerator<Uint8Array> {
  if (typeof body === "string") {
    yield Buffer.from(body);
    return;
  }
  if (body instanceof Uint8Array) {
    yield body;
    return;
  }
  for await (const chunk of body) yield chunk;
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
  private readonly ready: Promise<string>;

  constructor(options: LocalObjectStoreOptions) {
    if (!isAbsolute(options.rootDirectory)) {
      throw new Error("rootDirectory must be absolute");
    }
    this.rootDirectory = resolve(options.rootDirectory);
    this.publicBaseUrl = (options.publicBaseUrl ?? "/files/content").replace(/\/$/, "");
    this.ready = this.initialize();
  }

  async put(key: string, body: ObjectBody, options: PutObjectOptions = {}): Promise<StoredObject> {
    const normalized = normalizeKey(key);
    const path = await this.safePath(normalized, true);
    const temporary = join(dirname(path), `.podokit-${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    let size = 0;
    try {
      for await (const chunk of objectChunks(body)) {
        size += chunk.byteLength;
        await handle.write(chunk);
      }
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

  close(): void {}

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
    const root = await this.ready;
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

  private async initialize(): Promise<string> {
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    return realpath(this.rootDirectory);
  }

  private async safePath(key: string, createParents: boolean): Promise<string> {
    const root = await this.ready;
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
    const root = await this.ready;
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
