export const PROVIDER_CAPABILITIES = [
  "database",
  "cache",
  "object-storage",
  "events",
  "jobs",
] as const;

export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];

export const PROVIDER_NAMES = {
  database: ["postgres", "sqlite"],
  cache: ["redis", "memory"],
  "object-storage": ["s3", "local"],
  events: ["redis", "memory"],
  jobs: ["bullmq", "local"],
} as const satisfies Record<ProviderCapability, readonly string[]>;

export type DatabaseProviderName = (typeof PROVIDER_NAMES.database)[number];
export type CacheProviderName = (typeof PROVIDER_NAMES.cache)[number];
export type ObjectStorageProviderName = (typeof PROVIDER_NAMES)["object-storage"][number];
export type EventsProviderName = (typeof PROVIDER_NAMES.events)[number];
export type JobsProviderName = (typeof PROVIDER_NAMES.jobs)[number];

export interface ProviderSelections {
  database: DatabaseProviderName;
  cache: CacheProviderName;
  "object-storage": ObjectStorageProviderName;
  events: EventsProviderName;
  jobs: JobsProviderName;
}

export const SERVER_PROVIDER_SELECTIONS: ProviderSelections = {
  database: "postgres",
  cache: "redis",
  "object-storage": "s3",
  events: "redis",
  jobs: "bullmq",
};

export const LOCAL_PROVIDER_SELECTIONS: ProviderSelections = {
  database: "sqlite",
  cache: "memory",
  "object-storage": "local",
  events: "memory",
  jobs: "local",
};

export function isProviderCapability(value: string): value is ProviderCapability {
  return (PROVIDER_CAPABILITIES as readonly string[]).includes(value);
}

export function isProviderName<C extends ProviderCapability>(
  capability: C,
  value: string,
): value is ProviderSelections[C] {
  return (PROVIDER_NAMES[capability] as readonly string[]).includes(value);
}

export function resolveProviderSelections(
  selections: Partial<Record<ProviderCapability, string>> = {},
): ProviderSelections {
  const resolveOne = <C extends ProviderCapability>(capability: C): ProviderSelections[C] => {
    const value = selections[capability] ?? SERVER_PROVIDER_SELECTIONS[capability];
    if (!isProviderName(capability, value)) {
      throw new Error(
        `Unknown ${capability} provider "${value}". Use one of: ${PROVIDER_NAMES[capability].join(", ")}.`,
      );
    }
    return value;
  };
  return {
    database: resolveOne("database"),
    cache: resolveOne("cache"),
    "object-storage": resolveOne("object-storage"),
    events: resolveOne("events"),
    jobs: resolveOne("jobs"),
  };
}

export type ServiceKey<T> = symbol & { readonly __service?: T };

export interface DatabaseProvider {
  readonly provider: DatabaseProviderName;
  ping(): Promise<void>;
  close(): void | Promise<void>;
}

export interface CacheSetOptions {
  ttlMs?: number;
}

export interface FixedWindowOptions {
  windowMs: number;
  limit: number;
}

export interface FixedWindowResult {
  allowed: boolean;
  count: number;
  remaining: number;
  resetAt: number;
}

export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: CacheSetOptions): Promise<void>;
  delete(key: string): Promise<boolean>;
  incrementFixedWindow(key: string, options: FixedWindowOptions): Promise<FixedWindowResult>;
  close(): void | Promise<void>;
}

/**
 * Content to store. Streams and async iterables are read once, in order, and
 * never collected into one buffer by `put`.
 */
export type ObjectBody =
  | Uint8Array
  | string
  | Blob
  | ReadableStream<Uint8Array>
  | AsyncIterable<Uint8Array>;

export interface PutObjectOptions {
  contentType?: string;
}

export interface StoredObject {
  key: string;
  size: number;
  contentType?: string;
}

export interface ObjectInfo extends StoredObject {
  /** An HTTP entity tag, quotes included, that changes whenever the content changes. */
  etag: string;
  lastModified: Date;
}

export interface ObjectData extends ObjectInfo {
  /**
   * The content. A provider may open it on the first read or have its download
   * under way already, so read it to the end or cancel it, as with a fetch
   * response body.
   */
  body: ReadableStream<Uint8Array>;
}

export interface DownloadUrlOptions {
  expiresInSeconds?: number;
}

export interface ListObjectsOptions {
  /** The `nextCursor` of the previous page. */
  cursor?: string;
  /** Keys per page, from 1 to 1000. Defaults to 1000. */
  limit?: number;
}

export interface ObjectPage {
  /** Keys in ascending order. */
  keys: string[];
  /** Present only when more keys follow. */
  nextCursor?: string;
}

export interface CreateMultipartUploadOptions {
  contentType?: string;
}

export interface MultipartUpload {
  /** Opaque and provider-specific. */
  uploadId: string;
}

export interface UploadedPart {
  /** Pass it back to `completeMultipartUpload` with the part number. */
  etag: string;
  size: number;
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

export interface ObjectStore {
  /** Writes the whole object; streamed bodies are written as they are read. */
  put(key: string, body: ObjectBody, options?: PutObjectOptions): Promise<StoredObject>;
  /** Metadata and the content to read or cancel, or null when the object does not exist. */
  get(key: string): Promise<ObjectData | null>;
  /** Metadata only, or null when the object does not exist. */
  stat(key: string): Promise<ObjectInfo | null>;
  /** One page of the keys that start with `prefix`. */
  list(prefix: string, options?: ListObjectsOptions): Promise<ObjectPage>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  getDownloadUrl(key: string, options?: DownloadUrlOptions): Promise<string>;
  /**
   * Starts an object that is uploaded in numbered parts. Nothing is visible
   * under `key` until the upload completes.
   */
  createMultipartUpload(key: string, options?: CreateMultipartUploadOptions): Promise<MultipartUpload>;
  /**
   * Stores part `partNumber` (1 to `MAX_MULTIPART_PARTS`). Parts may arrive in
   * any order, and uploading a number again replaces that part. Every part
   * except the last must hold at least `MIN_MULTIPART_PART_BYTES`.
   */
  uploadPart(key: string, uploadId: string, partNumber: number, body: ObjectBody): Promise<UploadedPart>;
  /**
   * Joins the listed parts in part-number order into the object and ends the
   * upload. Parts that are not listed are discarded.
   */
  completeMultipartUpload(key: string, uploadId: string, parts: readonly CompletedPart[]): Promise<ObjectInfo>;
  /** Discards the upload and its parts; resolves when the upload no longer exists. */
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;
  close(): void | Promise<void>;
}

export type EventHandler = (event: unknown) => void | Promise<void>;
export type Unsubscribe = () => void | Promise<void>;

export interface EventBus {
  /** Resolves while published events reach subscribers; rejects otherwise, without waiting for a connection. */
  ready(): Promise<void>;
  publish(topic: string, event: unknown): Promise<void>;
  /**
   * Registers `handler` for `topic`. The registration does not wait for the
   * transport to connect and stays in place across reconnects.
   */
  subscribe(topic: string, handler: EventHandler): Promise<Unsubscribe>;
  /**
   * Calls `listener` each time delivery resumes after an interruption in which
   * events may have been lost, so consumers can tell their clients to reload.
   * A transport that cannot lose events leaves it out.
   */
  onInterruption?(listener: () => void): () => void;
  close(): void | Promise<void>;
}

export interface EnqueueOptions {
  delayMs?: number;
  attempts?: number;
  deduplicationKey?: string;
}

export type JobStatus = "waiting" | "active" | "completed" | "failed";

export interface JobReference {
  id: string;
  name: string;
}

export interface JobSnapshot extends JobReference {
  status: JobStatus;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  result?: unknown;
  error?: string;
}

export type JobHandler = (payload: unknown, job: JobReference) => void | Promise<void>;

/** The shortest interval a repeating schedule may use. */
export const MIN_REPEAT_INTERVAL_MS = 1_000;

/** When a schedule adds its job: give exactly one of `cron` and `everyMs`. */
export interface RepeatOptions {
  /**
   * A cron expression with five fields (minute, hour, day of month, month,
   * day of week) or six with seconds first, such as `"0 3 * * *"` for 03:00.
   */
  cron?: string;
  /** A fixed interval in milliseconds, at least `MIN_REPEAT_INTERVAL_MS`. */
  everyMs?: number;
  /** The IANA time zone `cron` is read in, such as `"Asia/Seoul"`. Defaults to UTC. */
  timezone?: string;
}

/**
 * Throws unless exactly one of `cron` and `everyMs` is set and `everyMs` is a
 * whole number of milliseconds of at least `MIN_REPEAT_INTERVAL_MS`. Providers
 * check the cron expression and the time zone themselves.
 */
export function assertRepeatOptions(repeat: RepeatOptions): void {
  const hasCron = repeat.cron !== undefined;
  const hasInterval = repeat.everyMs !== undefined;
  if (hasCron === hasInterval) throw new Error("A job schedule needs exactly one of cron and everyMs");
  if (hasCron && repeat.cron?.trim() === "") throw new Error("A job schedule's cron expression is empty");
  if (hasInterval && (!Number.isSafeInteger(repeat.everyMs) || (repeat.everyMs ?? 0) < MIN_REPEAT_INTERVAL_MS)) {
    throw new Error(`A job schedule's everyMs must be a whole number of at least ${MIN_REPEAT_INTERVAL_MS}`);
  }
  if (repeat.timezone !== undefined && !hasCron) throw new Error("A job schedule's timezone applies only to cron");
}

export interface JobQueue {
  enqueue(name: string, payload: unknown, options?: EnqueueOptions): Promise<JobReference>;
  get(id: string): Promise<JobSnapshot | null>;
  process(name: string, handler: JobHandler): Promise<Unsubscribe>;
  /**
   * Adds a `name` job with `payload` on a repeating schedule and replaces any
   * earlier schedule with the same `id`. The queue keeps its schedules and
   * applies them again when its connection is restored, so a backend that lost
   * them, such as a restarted Redis without persistence, gets them back. It
   * resolves while the backend is unreachable and applies the schedule once it
   * is reachable; an invalid schedule rejects. A worker or `process()` handler
   * for `name` runs the jobs. Missed times are not made up.
   */
  schedule(id: string, name: string, payload: unknown, repeat: RepeatOptions): Promise<void>;
  /** Stops the schedule `id`. Jobs it already added stay. */
  unschedule(id: string): Promise<void>;
  close(): void | Promise<void>;
}

/** A request budget of its own, counted per caller like the general budget. */
export interface RateLimitProfile {
  /**
   * Names the counter: 1 to 64 letters, digits, `_`, or `-`. Routes registered
   * with the same name share one budget and must give the same limits.
   */
  name: string;
  /** Requests allowed per window. */
  limit: number;
  /** Window length in seconds. Defaults to the general window (RATE_LIMIT_TTL). */
  ttlSeconds?: number;
}

export interface RateLimitRoute {
  /** Matches one HTTP method; omitted, every method. */
  method?: string;
  /**
   * Matches this path and the paths below it, by whole segments: `/uploads`
   * covers `/uploads` and `/uploads/1`, not `/uploads-old`. A `:name` segment
   * matches exactly one non-empty segment, so `/hosts/:hostId/files` covers
   * `/hosts/h1/files/2` but not `/hosts/files`. Names are a letter or `_`
   * followed by letters, digits, or `_`; other wildcard syntax and `.` or `..`
   * segments are rejected. Use the path the API receives, such as `/uploads`,
   * not `/api/uploads` as called through the web proxy; Better Auth routes keep
   * their `/api/auth` prefix.
   */
  pathPrefix: string;
  /** A budget of its own, or "exempt" to skip request limiting. */
  profile: RateLimitProfile | "exempt";
}

/**
 * Gives routes their own request budget or exempts them. The most specific
 * matching route wins: the prefix with more segments; at equal length, the
 * first segment from the left where one is literal and the other a parameter
 * decides for the literal; then a route with a method over one without; then
 * the latest registration.
 */
export interface RateLimitRouteRegistry {
  register(route: RateLimitRoute): void;
}

export const DATABASE = Symbol.for("@podosoft/podokit/database") as ServiceKey<DatabaseProvider>;
export const CACHE = Symbol.for("@podosoft/podokit/cache") as ServiceKey<CacheStore>;
export const OBJECT_STORAGE = Symbol.for("@podosoft/podokit/object-storage") as ServiceKey<ObjectStore>;
export const EVENTS = Symbol.for("@podosoft/podokit/events") as ServiceKey<EventBus>;
export const JOBS = Symbol.for("@podosoft/podokit/jobs") as ServiceKey<JobQueue>;
/**
 * Registered by the rate-limit module. Resolve it with `tryResolve` so a module
 * keeps working when rate limiting is not installed.
 */
export const RATE_LIMIT_ROUTES = Symbol.for("@podosoft/podokit/rate-limit-routes") as ServiceKey<RateLimitRouteRegistry>;
