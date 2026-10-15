import { afterEach, describe, expect, mock, test } from "bun:test";
import { SQL } from "bun";
import type { QueryRunner } from "typeorm";
import type { AuthSession } from "../auth/auth.service";
import { InitAuditLogs1720300000000 } from "../migrations/1720300000000-InitAuditLogs";
import { recordAudit, recordAuditLater } from "./audit-events";
import { AuditService, type AuditLogger } from "./audit.service";

const on = (): Promise<boolean> => Promise.resolve(true);
const off = (): Promise<boolean> => Promise.resolve(false);

let open: SQL | undefined;

afterEach(async () => {
  await open?.close();
  open = undefined;
});

async function sqliteDatabase(): Promise<SQL> {
  const sql = new SQL(":memory:");
  open = sql;
  const runner = {
    connection: { options: { type: "better-sqlite3" } },
    query: (query: string): Promise<unknown> => sql.unsafe(query),
  } as unknown as QueryRunner;
  await new InitAuditLogs1720300000000().up(runner);
  return sql;
}

async function storedRows(sql: SQL): Promise<Array<{ action: string; metadata: unknown }>> {
  return sql<Array<{ action: string; metadata: unknown }>>`
    SELECT "action", "metadata" FROM "audit_logs" ORDER BY "createdAt", "action"
  `;
}

// Captures each INSERT's rows as the service binds them, so batching and the
// PostgreSQL encoding can be checked without a server.
function sqlCapture(): { sql: SQL; batches: Array<Array<Record<string, unknown>>>; failNext: () => void } {
  const batches: Array<Array<Record<string, unknown>>> = [];
  let fail = false;
  const tag = (first: unknown, ...rest: unknown[]): unknown => {
    if (Array.isArray(first) && "raw" in first) {
      if (fail) {
        fail = false;
        return Promise.reject(new Error("database unavailable"));
      }
      for (const value of rest) {
        const helper = value as { rows?: Array<Record<string, unknown>> };
        if (helper.rows) batches.push(helper.rows);
      }
      return Promise.resolve([]);
    }
    return { rows: first };
  };
  return { sql: tag as unknown as SQL, batches, failNext: () => { fail = true; } };
}

function warnings(): { logger: AuditLogger; messages: string[] } {
  const messages: string[] = [];
  return { logger: { warn: (_details, message) => { messages.push(message); } }, messages };
}

async function waitFor(condition: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for the condition");
    await Bun.sleep(5);
  }
}

describe("AuditService", () => {
  test("writes global audit events through one recorder", async () => {
    const sql = await sqliteDatabase();
    const service = new AuditService(sql, { dialect: "sqlite", enabled: on });
    service.connect();
    try {
      await recordAudit({ action: "invoice.paid", actorId: "user-1", metadata: { amount: 42 } });
      const [row] = await storedRows(sql);
      expect(row?.action).toBe("invoice.paid");
      expect(row?.metadata).toBe('{"amount":42}');
    } finally {
      await service.close();
    }
  });

  test("binds PostgreSQL metadata as an object so jsonb stores an object", async () => {
    const capture = sqlCapture();
    await new AuditService(capture.sql, { dialect: "postgres", enabled: on })
      .record({ action: "invoice.paid", metadata: { amount: 42 } });
    expect(capture.batches).toHaveLength(1);
    expect(capture.batches[0]?.[0]).toMatchObject({ action: "invoice.paid", metadata: { amount: 42 } });
  });

  test("returns recent entries with serialized timestamps and parsed metadata", async () => {
    const sql = await sqliteDatabase();
    const service = new AuditService(sql, { dialect: "sqlite", enabled: on });
    await service.record({ action: "auth.login", metadata: { method: "password" } });
    const [entry] = await service.recent();
    expect(entry?.metadata).toEqual({ method: "password" });
    expect(entry?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test("does not propagate persistence failures", async () => {
    const sql = mock((first: unknown) =>
      Array.isArray(first) && "raw" in first ? Promise.reject(new Error("database unavailable")) : {}
    ) as unknown as SQL;
    const service = new AuditService(sql, { dialect: "postgres", enabled: on });
    await expect(service.record({ action: "auth.login" })).resolves.toBeUndefined();
  });

  test("record() skips the write while the toggle is off", async () => {
    const sql = await sqliteDatabase();
    await new AuditService(sql, { dialect: "sqlite", enabled: off }).record({ action: "invoice.paid" });
    expect(await storedRows(sql)).toHaveLength(0);
  });

  test("every write path goes through the toggle in record()", async () => {
    const sql = await sqliteDatabase();
    let enabled = false;
    const service = new AuditService(sql, { dialect: "sqlite", enabled: () => Promise.resolve(enabled) });
    const session: AuthSession = { user: { id: "user-1", email: "a@example.com" }, session: {} };
    service.connect();
    try {
      await recordAudit({ action: "invoice.paid" });
      await service.recordRequest("todo.create", new Request("http://localhost/todos"), session);
      expect(await storedRows(sql)).toHaveLength(0);

      enabled = true;
      await recordAudit({ action: "invoice.paid" });
      await service.recordRequest("todo.create", new Request("http://localhost/todos"), session);
      expect((await storedRows(sql)).map((row) => row.action).sort()).toEqual(["invoice.paid", "todo.create"]);
    } finally {
      await service.close();
    }
  });

  test("a failing toggle read never breaks the caller", async () => {
    const sql = await sqliteDatabase();
    const service = new AuditService(sql, {
      dialect: "sqlite",
      enabled: () => Promise.reject(new Error("store down")),
    });
    await expect(service.record({ action: "auth.login" })).resolves.toBeUndefined();
  });
});

describe("deferred recording", () => {
  test("writes a full batch with one INSERT without waiting for the timer", async () => {
    const capture = sqlCapture();
    const service = new AuditService(capture.sql, {
      dialect: "postgres",
      enabled: on,
      queue: { batchSize: 3, flushIntervalMs: 60_000 },
    });
    for (const id of ["1", "2", "3"]) service.recordLater({ action: "comment.create", targetId: id });
    await waitFor(() => capture.batches.length === 1);
    expect(capture.batches[0]?.map((row) => row.targetId)).toEqual(["1", "2", "3"]);
    await service.close();
    expect(capture.batches).toHaveLength(1);
  });

  test("writes a partial batch when the flush interval elapses", async () => {
    const capture = sqlCapture();
    const service = new AuditService(capture.sql, {
      dialect: "postgres",
      enabled: on,
      queue: { batchSize: 100, flushIntervalMs: 20 },
    });
    service.recordLater({ action: "comment.create" });
    service.recordLater({ action: "comment.update" });
    expect(capture.batches).toHaveLength(0);
    await waitFor(() => capture.batches.length === 1);
    expect(capture.batches[0]).toHaveLength(2);
    await service.close();
  });

  test("close() writes the entries still queued", async () => {
    const capture = sqlCapture();
    const service = new AuditService(capture.sql, {
      dialect: "postgres",
      enabled: on,
      queue: { flushIntervalMs: 60_000 },
    });
    service.connect();
    recordAuditLater({ action: "comment.create" });
    service.recordLater({ action: "comment.delete" });
    expect(capture.batches).toHaveLength(0);
    await service.close();
    expect(capture.batches[0]?.map((row) => row.action)).toEqual(["comment.create", "comment.delete"]);
  });

  test("drops entries past the queue bound and records the loss", async () => {
    const capture = sqlCapture();
    const { logger, messages } = warnings();
    const service = new AuditService(capture.sql, {
      dialect: "postgres",
      enabled: on,
      logger,
      queue: { maxQueued: 2, batchSize: 100, flushIntervalMs: 60_000 },
    });
    for (let index = 0; index < 5; index += 1) service.recordLater({ action: "comment.create" });
    expect(messages).toEqual(["Audit queue is full; dropping deferred entries"]);
    await service.close();
    const batch = capture.batches[0] ?? [];
    expect(batch).toHaveLength(3);
    expect(batch[2]).toMatchObject({ action: "audit.dropped", metadata: { count: 3 } });
  });

  test("counts a failed batch and records the loss with the next write", async () => {
    const capture = sqlCapture();
    const { logger, messages } = warnings();
    const service = new AuditService(capture.sql, {
      dialect: "postgres",
      enabled: on,
      logger,
      queue: { flushIntervalMs: 60_000 },
    });
    capture.failNext();
    service.recordLater({ action: "comment.create" });
    service.recordLater({ action: "comment.create" });
    await service.flush();
    expect(capture.batches).toHaveLength(0);
    expect(messages).toEqual(["Audit batch write failed"]);

    service.recordLater({ action: "comment.update" });
    await service.close();
    expect(capture.batches[0]).toEqual([
      expect.objectContaining({ action: "comment.update" }),
      expect.objectContaining({ action: "audit.dropped", metadata: { count: 2 } }),
    ]);
  });

  test("discards deferred entries while the toggle is off", async () => {
    const capture = sqlCapture();
    const service = new AuditService(capture.sql, { dialect: "postgres", enabled: off });
    service.recordLater({ action: "comment.create" });
    await service.close();
    expect(capture.batches).toHaveLength(0);
  });

  test("recordRequest() queues the entry when asked to defer", async () => {
    const capture = sqlCapture();
    const service = new AuditService(capture.sql, {
      dialect: "postgres",
      enabled: on,
      queue: { flushIntervalMs: 60_000 },
    });
    const session: AuthSession = { user: { id: "user-1", email: "a@example.com" }, session: {} };
    await service.recordRequest("comment.create", new Request("http://localhost/comments"), session, {}, {
      defer: true,
    });
    expect(capture.batches).toHaveLength(0);
    await service.close();
    expect(capture.batches[0]?.[0]).toMatchObject({ action: "comment.create", actorEmail: "a@example.com" });
  });
});
