import { describe, expect, it } from "bun:test";
import { SQL } from "bun";
import { Database as SqliteDatabase } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  revertLatestSqliteMigration,
  runSqliteMigrations,
  type SqliteMigrationDefinition,
} from "../database/sqlite-migrator";
import { InitTodos1720100000000 } from "../migrations/1720100000000-InitTodos";
import { TodoRepository } from "./todo.repository";

const migrations: readonly SqliteMigrationDefinition[] = [
  { timestamp: 1720100000000, migration: new InitTodos1720100000000() },
];

describe("Todo SQLite persistence", () => {
  it("preserves boolean and Date rows returned by PostgreSQL", async (): Promise<void> => {
    const row = {
      id: crypto.randomUUID(),
      title: "Existing task",
      completed: true,
      createdAt: new Date("2026-10-07T00:00:00.000Z"),
    };
    const sql = ((): Promise<typeof row[]> => Promise.resolve([row])) as unknown as SQL;
    expect(await new TodoRepository(sql).find(row.id)).toEqual({
      ...row,
      createdAt: "2026-10-07T00:00:00.000Z",
    });
  });

  it("applies the initial migration once and reverts it", async (): Promise<void> => {
    const database = new SqliteDatabase(":memory:");
    try {
      await runSqliteMigrations(database, migrations);
      await runSqliteMigrations(database, migrations);
      expect(database.query<{ count: number }, []>("SELECT count(*) AS count FROM migrations").get()?.count).toBe(1);
      expect(database.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE name = 'todos'").get()?.name).toBe("todos");
      expect(await revertLatestSqliteMigration(database, migrations)).toBe(true);
      expect(database.query("SELECT name FROM sqlite_master WHERE name = 'todos'").get()).toBeNull();
    } finally {
      database.close();
    }
  });

  it("creates, reads, updates, and removes records with stable API types", async (): Promise<void> => {
    const directory = mkdtempSync(join(tmpdir(), "podokit-todo-"));
    const path = join(directory, "podokit.sqlite");
    const database = new SqliteDatabase(path);
    let sql: SQL | undefined;
    try {
      await runSqliteMigrations(database, migrations);
      sql = new SQL(`sqlite://${path}`, { adapter: "sqlite" });
      const repository = new TodoRepository(sql);
      const todo = await repository.create("First task");
      expect(todo.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(todo.completed).toBe(false);
      expect(new Date(todo.createdAt).toISOString()).toBe(todo.createdAt);
      expect(await repository.find(todo.id)).toEqual(todo);
      expect(await repository.all()).toEqual([todo]);

      const updated = await repository.update(todo.id, { title: "Completed task", completed: true });
      expect(updated).toEqual({ ...todo, title: "Completed task", completed: true });
      expect(await repository.remove(todo.id)).toBe(true);
      expect(await repository.find(todo.id)).toBeNull();
      expect(await repository.update(todo.id, { completed: false })).toBeNull();
      expect(await repository.remove(todo.id)).toBe(false);
    } finally {
      await sql?.close();
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
