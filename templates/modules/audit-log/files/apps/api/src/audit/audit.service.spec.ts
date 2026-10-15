import { describe, expect, mock, test } from "bun:test";
import type { SQL } from "bun";
import type { AuthSession } from "../auth/auth.service";
import { recordAudit } from "./audit-events";
import { AuditService } from "./audit.service";

const on = (): Promise<boolean> => Promise.resolve(true);
const off = (): Promise<boolean> => Promise.resolve(false);

function sqlRecorder(rows: unknown[] = []): { sql: SQL; values: unknown[][] } {
  const values: unknown[][] = [];
  const tag = mock((_strings: TemplateStringsArray, ...parameters: unknown[]) => {
    values.push(parameters);
    return Promise.resolve(rows);
  });
  return { sql: tag as unknown as SQL, values };
}

describe("AuditService", () => {
  test("writes global audit events through one recorder", async () => {
    const recorder = sqlRecorder();
    const service = new AuditService(recorder.sql, { enabled: on });
    service.connect();
    try {
      await recordAudit({
        action: "invoice.paid",
        actorId: "user-1",
        metadata: { amount: 42 },
      });
      expect(recorder.values).toHaveLength(1);
      expect(recorder.values[0]).toContain("invoice.paid");
      expect(recorder.values[0]).toContain('{"amount":42}');
      expect(recorder.values[0]?.[0]).toBeString();
    } finally {
      service.close();
    }
  });

  test("returns recent entries with serialized timestamps", async () => {
    const recorder = sqlRecorder([{
      id: "audit-1",
      action: "auth.login",
      createdAt: new Date("2026-01-02T03:04:05.000Z"),
    }]);
    const entries = await new AuditService(recorder.sql, { enabled: on }).recent();
    expect(entries[0]?.createdAt).toBe("2026-01-02T03:04:05.000Z");
  });

  test("normalizes SQLite timestamps and JSON text", async () => {
    const recorder = sqlRecorder([{
      id: "audit-1",
      action: "auth.login",
      metadata: '{"method":"password"}',
      createdAt: "2026-01-02T03:04:05.000Z",
    }]);
    const entries = await new AuditService(recorder.sql, { enabled: on }).recent();
    expect(entries[0]?.metadata).toEqual({ method: "password" });
    expect(entries[0]?.createdAt).toBe("2026-01-02T03:04:05.000Z");
  });

  test("does not propagate persistence failures", async () => {
    const sql = mock(() => Promise.reject(new Error("database unavailable"))) as unknown as SQL;
    await expect(new AuditService(sql, { enabled: on }).record({ action: "auth.login" })).resolves.toBeUndefined();
  });

  test("record() skips the write while the toggle is off", async () => {
    const recorder = sqlRecorder();
    const service = new AuditService(recorder.sql, { enabled: off });
    await service.record({ action: "invoice.paid" });
    expect(recorder.values).toHaveLength(0);
  });

  test("every write path goes through the toggle in record()", async () => {
    const recorder = sqlRecorder();
    let enabled = false;
    const service = new AuditService(recorder.sql, { enabled: () => Promise.resolve(enabled) });
    const session: AuthSession = { user: { id: "user-1", email: "a@example.com" }, session: {} };
    service.connect();
    try {
      await recordAudit({ action: "invoice.paid" });
      await service.recordRequest("todo.create", new Request("http://localhost/todos"), session);
      expect(recorder.values).toHaveLength(0);

      enabled = true;
      await recordAudit({ action: "invoice.paid" });
      await service.recordRequest("todo.create", new Request("http://localhost/todos"), session);
      expect(recorder.values).toHaveLength(2);
    } finally {
      service.close();
    }
  });

  test("a failing toggle read never breaks the caller", async () => {
    const recorder = sqlRecorder();
    const service = new AuditService(recorder.sql, { enabled: () => Promise.reject(new Error("store down")) });
    await expect(service.record({ action: "auth.login" })).resolves.toBeUndefined();
  });
});
