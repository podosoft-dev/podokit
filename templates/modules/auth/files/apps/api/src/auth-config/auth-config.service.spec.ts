import { describe, expect, it, mock } from "bun:test";
import { SQL } from "bun";

mock.module("../auth/auth-provider", () => ({ refreshAuthNow: async (): Promise<void> => undefined }));
const { AuthConfigService } = await import("./auth-config.service");

async function sqliteConfigTable(): Promise<SQL> {
  const sql = new SQL("sqlite://:memory:");
  await sql`
    CREATE TABLE "auth_config" (
      "key" text NOT NULL PRIMARY KEY,
      "enabled" integer NOT NULL DEFAULT 0,
      "config" text NOT NULL DEFAULT '{}',
      "secret" text,
      "updatedAt" datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;
  return sql;
}

describe("auth config writes", () => {
  it("stores and merges server settings as JSON text on SQLite", async () => {
    const sql = await sqliteConfigTable();
    const service = new AuthConfigService(sql, "sqlite");

    await service.update({ server: { allowDelete: true } });
    await service.update({ server: { hibp: true } });

    const [row] = await sql<Array<{ config: unknown }>>`
      SELECT "config" FROM "auth_config" WHERE "key" = 'server'
    `;
    expect(typeof row?.config).toBe("string");
    expect(JSON.parse(String(row?.config))).toMatchObject({ allowDelete: true, hibp: true });
    await sql.close();
  });
});
