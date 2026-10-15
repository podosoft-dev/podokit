import { afterEach, describe, expect, mock, test } from "bun:test";
import { SQL } from "bun";
import type { QueryRunner } from "typeorm";
import type { AuthSession } from "../auth/auth.service";
import { InitAuditLogs1720300000000 } from "../migrations/1720300000000-InitAuditLogs";
import { recordAudit } from "./audit-events";
import { AuditService } from "./audit.service";

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

// Captures what the service binds, so the PostgreSQL encoding can be checked
// without a server.
function postgresRecorder(): { sql: SQL; inserted: unknown[] } {
  const inserted: unknown[] = [];
  const tag = mock((first: unknown, ...rest: unknown[]) => {
    if (Array.isArray(first) && "raw" in first) {
      for (const value of rest) {
        const helper = value as { rows?: unknown[] };
        if (helper.rows) inserted.push(...helper.rows);
      }
      return Promise.resolve([]);
    }
    return { rows: first };
  });
  return { sql: tag as unknown as SQL, inserted };
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
      service.close();
    }
  });

  test("binds PostgreSQL metadata as an object so jsonb stores an object", async () => {
    const recorder = postgresRecorder();
    await new AuditService(recorder.sql, { dialect: "postgres", enabled: on })
      .record({ action: "invoice.paid", metadata: { amount: 42 } });
    expect(recorder.inserted).toHaveLength(1);
    expect(recorder.inserted[0]).toMatchObject({ action: "invoice.paid", metadata: { amount: 42 } });
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
      service.close();
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
