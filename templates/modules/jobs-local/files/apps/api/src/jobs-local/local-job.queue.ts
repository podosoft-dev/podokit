import type { SQL } from "bun";
import {
  type EnqueueOptions,
  type JobHandler,
  type JobQueue,
  type JobReference,
  type JobSnapshot,
  type JobStatus,
  type Unsubscribe,
} from "@podosoft/podokit-runtime";

interface JobRow {
  id: string;
  name: string;
  payload: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  availableAt: number;
  createdAt: number;
  updatedAt: number;
  error: string | null;
}

export interface LocalJobQueueOptions {
  pollIntervalMs?: number;
  now?: () => number;
}

export class LocalJobQueue implements JobQueue {
  private readonly handlers = new Map<string, JobHandler>();
  private readonly pollIntervalMs: number;
  private readonly now: () => number;
  private timer?: ReturnType<typeof setTimeout>;
  private started = false;
  private initialized?: Promise<void>;

  constructor(
    private readonly sql: SQL,
    options: LocalJobQueueOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 250;
    if (!Number.isSafeInteger(this.pollIntervalMs) || this.pollIntervalMs < 10) {
      throw new Error("pollIntervalMs must be an integer of at least 10");
    }
    this.now = options.now ?? Date.now;
  }

  initialize(): Promise<void> {
    this.initialized ??= (async () => {
      await this.sql`
        CREATE TABLE IF NOT EXISTS "podokit_job" (
          "id" text PRIMARY KEY,
          "name" text NOT NULL,
          "payload" text NOT NULL,
          "status" text NOT NULL,
          "attempts" integer NOT NULL,
          "maxAttempts" integer NOT NULL,
          "availableAt" bigint NOT NULL,
          "createdAt" bigint NOT NULL,
          "updatedAt" bigint NOT NULL,
          "error" text
        )
      `;
      await this.sql`
        CREATE INDEX IF NOT EXISTS "podokit_job_pending"
        ON "podokit_job" ("status", "availableAt", "createdAt")
      `;
    })();
    return this.initialized;
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.initialize();
    this.started = true;
    this.schedule(0);
  }

  async enqueue(
    name: string,
    payload: unknown,
    options: EnqueueOptions = {},
  ): Promise<JobReference> {
    await this.initialize();
    const encoded = JSON.stringify(payload);
    if (encoded === undefined) throw new Error("Job payload must be JSON serializable");
    const now = this.now();
    const id = options.deduplicationKey
      ? `${name}:${options.deduplicationKey}`
      : crypto.randomUUID();
    const attempts = options.attempts ?? 1;
    const delayMs = options.delayMs ?? 0;
    if (!Number.isSafeInteger(attempts) || attempts < 1) {
      throw new Error("attempts must be a positive integer");
    }
    if (!Number.isSafeInteger(delayMs) || delayMs < 0) {
      throw new Error("delayMs must be a non-negative integer");
    }
    await this.sql`
      INSERT INTO "podokit_job" (
        "id", "name", "payload", "status", "attempts", "maxAttempts",
        "availableAt", "createdAt", "updatedAt", "error"
      ) VALUES (
        ${id}, ${name}, ${encoded}, 'waiting', 0, ${attempts},
        ${now + delayMs}, ${now}, ${now}, NULL
      )
      ON CONFLICT ("id") DO NOTHING
    `;
    return { id, name };
  }

  async get(id: string): Promise<JobSnapshot | null> {
    await this.initialize();
    const rows = await this.sql<JobRow[]>`
      SELECT "id", "name", "payload", "status", "attempts", "maxAttempts",
             "availableAt", "createdAt", "updatedAt", "error"
      FROM "podokit_job" WHERE "id" = ${id}
    `;
    const row = rows[0];
    return row ? this.snapshot(row) : null;
  }

  process(name: string, handler: JobHandler): Promise<Unsubscribe> {
    if (this.handlers.has(name)) throw new Error(`A handler is already registered for job ${name}`);
    this.handlers.set(name, handler);
    return Promise.resolve(() => {
      this.handlers.delete(name);
    });
  }

  async runOnce(): Promise<boolean> {
    await this.initialize();
    const now = this.now();
    const rows = await this.sql<JobRow[]>`
      UPDATE "podokit_job"
      SET "status" = 'active', "attempts" = "attempts" + 1, "updatedAt" = ${now}
      WHERE "id" = (
        SELECT "id" FROM "podokit_job"
        WHERE "status" = 'waiting' AND "availableAt" <= ${now}
        ORDER BY "createdAt" ASC LIMIT 1
      ) AND "status" = 'waiting'
      RETURNING "id", "name", "payload", "status", "attempts", "maxAttempts",
                "availableAt", "createdAt", "updatedAt", "error"
    `;
    const row = rows[0];
    if (!row) return false;
    const handler = this.handlers.get(row.name);
    if (!handler) {
      await this.fail(row, new Error(`No handler is registered for job ${row.name}`));
      return true;
    }
    try {
      await handler(JSON.parse(row.payload) as unknown, { id: row.id, name: row.name });
      const completedAt = this.now();
      await this.sql`
        UPDATE "podokit_job"
        SET "status" = 'completed', "updatedAt" = ${completedAt}, "error" = NULL
        WHERE "id" = ${row.id}
      `;
    } catch (error) {
      await this.fail(row, error);
    }
    return true;
  }

  close(): void {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.handlers.clear();
  }

  private schedule(delay: number): void {
    if (!this.started) return;
    this.timer = setTimeout(() => {
      void this.runOnce()
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          process.stderr.write(`Process local job failed: ${message}\n`);
        })
        .finally(() => this.schedule(this.pollIntervalMs));
    }, delay);
    this.timer.unref?.();
  }

  private async fail(row: JobRow, error: unknown): Promise<void> {
    const failedAt = this.now();
    const message = error instanceof Error ? error.message : String(error);
    const retry = row.attempts < row.maxAttempts;
    await this.sql`
      UPDATE "podokit_job"
      SET "status" = ${retry ? "waiting" : "failed"},
          "availableAt" = ${retry ? failedAt + this.pollIntervalMs : failedAt},
          "updatedAt" = ${failedAt},
          "error" = ${message.slice(0, 2_000)}
      WHERE "id" = ${row.id}
    `;
  }

  private snapshot(row: JobRow): JobSnapshot {
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      attempts: row.attempts,
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
      ...(row.error ? { error: row.error } : {}),
    };
  }
}
