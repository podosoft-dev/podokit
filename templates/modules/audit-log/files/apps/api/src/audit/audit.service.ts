import type { SQL } from "bun";
import type { DatabaseProviderName } from "@podosoft/podokit-runtime";
import type { AuthSession } from "../auth/auth.service";
import { setAuditRecorder, type AuditEntry } from "./audit-events";

export interface AuditLogView extends AuditEntry {
  id: string;
  createdAt: string;
}

type AuditLogRow = Omit<AuditLogView, "createdAt" | "metadata"> & {
  createdAt: Date | string;
  metadata: unknown;
};

// A type alias, not an interface: Bun's insert helper needs an indexable row.
type AuditRow = {
  id: string;
  action: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  ip: string | null;
  metadata: Record<string, unknown> | string | null;
  createdAt: string;
};

const COLUMNS = [
  "id", "action", "actorId", "actorName", "actorEmail",
  "targetType", "targetId", "targetLabel", "ip", "metadata", "createdAt",
] as const satisfies readonly (keyof AuditRow)[];

export interface AuditTarget {
  type?: string;
  id?: string;
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditQueueOptions {
  /** Deferred entries held in memory; once full, new deferred entries are dropped. */
  maxQueued: number;
  /** Rows per INSERT. A full batch is written without waiting for the timer. */
  batchSize: number;
  flushIntervalMs: number;
}

export const DEFAULT_AUDIT_QUEUE: AuditQueueOptions = {
  maxQueued: 1_000,
  batchSize: 100,
  flushIntervalMs: 250,
};

export interface AuditLogger {
  warn(details: Record<string, unknown>, message: string): void;
}

export interface AuditServiceOptions {
  dialect: DatabaseProviderName;
  /** The admin on/off toggle, read before every write. */
  enabled: () => Promise<boolean>;
  logger?: AuditLogger;
  queue?: Partial<AuditQueueOptions>;
}

export interface RecordRequestOptions {
  /** Queue the entry instead of awaiting the write. See `recordLater()`. */
  defer?: boolean;
}

export class AuditService {
  private unregister?: () => void;
  private readonly dialect: DatabaseProviderName;
  private readonly enabled: () => Promise<boolean>;
  private readonly logger?: AuditLogger;
  private readonly queueOptions: AuditQueueOptions;
  private queue: AuditRow[] = [];
  private dropped = 0;
  private failing = false;
  private flushTimer?: ReturnType<typeof setTimeout>;
  private flushing?: Promise<void>;

  constructor(private readonly sql: SQL, options: AuditServiceOptions) {
    this.dialect = options.dialect;
    this.enabled = options.enabled;
    this.logger = options.logger;
    this.queueOptions = { ...DEFAULT_AUDIT_QUEUE, ...options.queue };
  }

  connect(): void {
    this.unregister ??= setAuditRecorder({
      record: (entry) => this.record(entry),
      recordLater: (entry) => this.recordLater(entry),
    });
  }

  /** Stops accepting entries through the registry and writes the queue. */
  async close(): Promise<void> {
    this.unregister?.();
    this.unregister = undefined;
    await this.flush();
  }

  /** Writes the entry before resolving. Use for security events. */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.persist([this.row(entry)]);
    } catch (error) {
      // Audit persistence must never break the operation it describes.
      this.logger?.warn({ action: entry.action, error: message(error) }, "Audit write failed");
    }
  }

  /**
   * Queues the entry and returns at once. Queued entries are written together
   * every `flushIntervalMs`, as soon as a batch fills, and on `close()`. Entries
   * still queued when the process dies are lost, so keep security events on
   * `record()`.
   */
  recordLater(entry: AuditEntry): void {
    try {
      if (this.queue.length >= this.queueOptions.maxQueued) {
        // Waiting here would turn a slow database into slow requests, which is
        // what deferral avoids. The loss is recorded once the database recovers.
        if (this.dropped === 0) {
          this.logger?.warn(
            { maxQueued: this.queueOptions.maxQueued },
            "Audit queue is full; dropping deferred entries",
          );
        }
        this.dropped += 1;
        return;
      }
      this.queue.push(this.row(entry));
      if (this.queue.length >= this.queueOptions.batchSize) void this.flush();
      else this.scheduleFlush();
    } catch (error) {
      this.logger?.warn({ action: entry.action, error: message(error) }, "Audit entry could not be queued");
    }
  }

  /** Writes every queued entry, one INSERT per batch. */
  flush(): Promise<void> {
    this.flushing ??= this.drain().finally(() => {
      this.flushing = undefined;
      if (this.queue.length > 0) this.scheduleFlush();
    });
    return this.flushing;
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      void this.flush();
    }, this.queueOptions.flushIntervalMs);
    this.flushTimer.unref?.();
  }

  private async drain(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    while (this.queue.length > 0 || this.dropped > 0) {
      const batch = this.queue.splice(0, this.queueOptions.batchSize);
      const dropped = this.dropped;
      this.dropped = 0;
      if (dropped > 0) batch.push(this.row({ action: "audit.dropped", metadata: { count: dropped } }));
      try {
        await this.persist(batch);
        this.failing = false;
      } catch (error) {
        this.dropped += dropped + batch.length - (dropped > 0 ? 1 : 0);
        if (!this.failing) {
          this.logger?.warn({ entries: this.dropped, error: message(error) }, "Audit batch write failed");
        }
        this.failing = true;
        return;
      }
    }
  }

  /** The one write path: checks the admin toggle, then inserts the rows. */
  private async persist(rows: AuditRow[]): Promise<void> {
    if (rows.length === 0 || !(await this.enabled())) return;
    await this.sql`INSERT INTO "audit_logs" ${this.sql(rows, ...COLUMNS)}`;
  }

  private row(entry: AuditEntry): AuditRow {
    const metadata = entry.metadata ?? null;
    return {
      id: crypto.randomUUID(),
      action: entry.action,
      actorId: entry.actorId ?? null,
      actorName: entry.actorName ?? null,
      actorEmail: entry.actorEmail ?? null,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      targetLabel: entry.targetLabel ?? null,
      ip: entry.ip ?? null,
      // Bun encodes a bound value as JSON for a jsonb column, so a pre-serialized
      // string would be stored as a JSON string. SQLite keeps the text column.
      metadata: metadata === null || this.dialect === "postgres" ? metadata : JSON.stringify(metadata),
      createdAt: new Date().toISOString(),
    };
  }

  async recent(limit = 50): Promise<AuditLogView[]> {
    const rows = await this.sql<AuditLogRow[]>`
      SELECT "id", "action", "actorId", "actorName", "actorEmail",
             "targetType", "targetId", "targetLabel", "ip", "metadata", "createdAt"
      FROM "audit_logs"
      ORDER BY "createdAt" DESC
      LIMIT ${limit}
    `;
    return rows.map((row) => ({
      ...row,
      metadata: typeof row.metadata === "string"
        ? JSON.parse(row.metadata) as Record<string, unknown>
        : row.metadata as Record<string, unknown> | null,
      createdAt: row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : new Date(row.createdAt).toISOString(),
    }));
  }

  async recordRequest(
    action: string,
    request: Request,
    session: AuthSession,
    target: AuditTarget = {},
    options: RecordRequestOptions = {},
  ): Promise<void> {
    const entry: AuditEntry = {
      action,
      actorId: session.user.id,
      actorName: typeof session.user.name === "string" ? session.user.name : null,
      actorEmail: typeof session.user.email === "string" ? session.user.email : null,
      targetType: target.type ?? null,
      targetId: target.id ?? null,
      targetLabel: target.label ?? null,
      metadata: target.metadata ?? null,
      ip: request.headers.get("x-forwarded-for") ?? null,
    };
    if (options.defer) this.recordLater(entry);
    else await this.record(entry);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
