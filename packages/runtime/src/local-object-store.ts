import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type {
  DownloadUrlOptions,
  ObjectBody,
  ObjectData,
  ObjectStore,
  PutObjectOptions,
  StoredObject,
} from "./contracts";

interface ObjectMetadata {
  contentType?: string;
}

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

async function* fileChunks(path: string): AsyncGenerator<Uint8Array> {
  for await (const chunk of createReadStream(path)) {
    if (typeof chunk === "string") yield Buffer.from(chunk);
    else yield chunk;
  }
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

  async get(key: string): Promise<ObjectData> {
    const normalized = normalizeKey(key);
    const path = await this.safePath(normalized, false);
    const details = await stat(path);
    if (!details.isFile()) throw new Error("Object is not a file");
    const metadata = await this.readMetadata(normalized);
    return {
      key: normalized,
      size: details.size,
      ...metadata,
      body: fileChunks(path),
    };
  }

  async exists(key: string): Promise<boolean> {
    try {
      const value = await this.get(key);
      return value.size >= 0;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
      throw error;
    }
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
          throw new Error("Object path contains a non-directory or symbolic link");
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
