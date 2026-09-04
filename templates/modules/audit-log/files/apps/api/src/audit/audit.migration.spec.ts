import { describe, expect, it } from "bun:test";
import type { QueryRunner } from "typeorm";
import { InitAuditLogs1720300000000 } from "../migrations/1720300000000-InitAuditLogs";

function runner(type: "postgres" | "better-sqlite3", queries: string[]): QueryRunner {
  return {
    connection: { options: { type } },
    query: (sql: string): Promise<unknown[]> => {
      queries.push(sql);
      return Promise.resolve([]);
    },
  } as unknown as QueryRunner;
}

describe("audit log migration", () => {
  it("retains PostgreSQL UUID and JSONB storage", async () => {
    const queries: string[] = [];
    await new InitAuditLogs1720300000000().up(runner("postgres", queries));
    expect(queries[0]).toContain("CREATE EXTENSION");
    expect(queries[1]).toContain("uuid NOT NULL DEFAULT gen_random_uuid()");
    expect(queries[1]).toContain("jsonb");
  });

  it("uses portable SQLite column types and defaults", async () => {
    const queries: string[] = [];
    await new InitAuditLogs1720300000000().up(runner("better-sqlite3", queries));
    expect(queries).toHaveLength(3);
    expect(queries[0]).toContain('"id" text NOT NULL');
    expect(queries[0]).toContain('"metadata" text');
    expect(queries[0]).toContain("DEFAULT CURRENT_TIMESTAMP");
    expect(queries.join("\n")).not.toContain("CREATE EXTENSION");
  });
});
