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

export type ObjectBody = string | Uint8Array | AsyncIterable<Uint8Array>;

export interface PutObjectOptions {
  contentType?: string;
}

export interface StoredObject {
  key: string;
  size: number;
  contentType?: string;
}

export interface ObjectData extends StoredObject {
  body: AsyncIterable<Uint8Array>;
}

export interface DownloadUrlOptions {
  expiresInSeconds?: number;
}

export interface ObjectStore {
  put(key: string, body: ObjectBody, options?: PutObjectOptions): Promise<StoredObject>;
  get(key: string): Promise<ObjectData>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  getDownloadUrl(key: string, options?: DownloadUrlOptions): Promise<string>;
  close(): void | Promise<void>;
}

export type EventHandler = (event: unknown) => void | Promise<void>;
export type Unsubscribe = () => void | Promise<void>;

export interface EventBus {
  ready(): Promise<void>;
  publish(topic: string, event: unknown): Promise<void>;
  subscribe(topic: string, handler: EventHandler): Promise<Unsubscribe>;
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

export interface JobQueue {
  enqueue(name: string, payload: unknown, options?: EnqueueOptions): Promise<JobReference>;
  get(id: string): Promise<JobSnapshot | null>;
  process(name: string, handler: JobHandler): Promise<Unsubscribe>;
  close(): void | Promise<void>;
}

export const DATABASE = Symbol.for("@podosoft/podokit/database") as ServiceKey<DatabaseProvider>;
export const CACHE = Symbol.for("@podosoft/podokit/cache") as ServiceKey<CacheStore>;
export const OBJECT_STORAGE = Symbol.for("@podosoft/podokit/object-storage") as ServiceKey<ObjectStore>;
export const EVENTS = Symbol.for("@podosoft/podokit/events") as ServiceKey<EventBus>;
export const JOBS = Symbol.for("@podosoft/podokit/jobs") as ServiceKey<JobQueue>;
