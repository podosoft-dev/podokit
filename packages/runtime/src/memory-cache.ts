import type {
  CacheSetOptions,
  CacheStore,
  FixedWindowOptions,
  FixedWindowResult,
} from "./contracts";

interface CacheEntry {
  value: string;
  expiresAt?: number;
}

interface CounterEntry {
  count: number;
  resetAt: number;
}

export interface MemoryCacheOptions {
  maxEntries?: number;
  maxValueBytes?: number;
  now?: () => number;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly counters = new Map<string, CounterEntry>();
  private readonly maxEntries: number;
  private readonly maxValueBytes: number;
  private readonly now: () => number;

  constructor(options: MemoryCacheOptions = {}) {
    this.maxEntries = positiveInteger(options.maxEntries ?? 10_000, "maxEntries");
    this.maxValueBytes = positiveInteger(options.maxValueBytes ?? 1_048_576, "maxValueBytes");
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    this.removeExpired();
    return this.entries.size;
  }

  get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry) return Promise.resolve(null);
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return Promise.resolve(null);
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return Promise.resolve(entry.value);
  }

  set(key: string, value: string, options: CacheSetOptions = {}): Promise<void> {
    if (Buffer.byteLength(value, "utf8") > this.maxValueBytes) {
      throw new Error(`Cache value exceeds maxValueBytes (${this.maxValueBytes})`);
    }
    const ttlMs = options.ttlMs;
    if (ttlMs !== undefined) positiveInteger(ttlMs, "ttlMs");
    this.removeExpired();
    if (!this.entries.has(key)) this.evictForInsert();
    this.entries.delete(key);
    this.entries.set(key, {
      value,
      ...(ttlMs === undefined ? {} : { expiresAt: this.now() + ttlMs }),
    });
    return Promise.resolve();
  }

  delete(key: string): Promise<boolean> {
    return Promise.resolve(this.entries.delete(key));
  }

  incrementFixedWindow(key: string, options: FixedWindowOptions): Promise<FixedWindowResult> {
    const windowMs = positiveInteger(options.windowMs, "windowMs");
    const limit = positiveInteger(options.limit, "limit");
    const now = this.now();
    const existing = this.counters.get(key);
    const entry = !existing || existing.resetAt <= now
      ? { count: 0, resetAt: now + windowMs }
      : existing;
    entry.count += 1;
    this.counters.set(key, entry);
    this.removeExpiredCounters(now);
    return Promise.resolve({
      allowed: entry.count <= limit,
      count: entry.count,
      remaining: Math.max(0, limit - entry.count),
      resetAt: entry.resetAt,
    });
  }

  close(): void {
    this.entries.clear();
    this.counters.clear();
  }

  private evictForInsert(): void {
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) return;
      this.entries.delete(oldest);
    }
  }

  private removeExpired(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  private removeExpiredCounters(now: number): void {
    for (const [key, entry] of this.counters) {
      if (entry.resetAt <= now) this.counters.delete(key);
    }
  }
}
