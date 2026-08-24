import type { SQL } from "bun";

export interface TodoRecord {
  id: string;
  title: string;
  completed: boolean;
  createdAt: string;
}

interface TodoRow {
  id: string;
  title: string;
  completed: boolean;
  createdAt: Date;
}

function record(row: TodoRow): TodoRecord {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

export class TodoRepository {
  constructor(private readonly sql: SQL) {}

  async all(): Promise<TodoRecord[]> {
    const rows = await this.sql<TodoRow[]>`
      SELECT id, title, completed, "createdAt"
      FROM todos
      ORDER BY "createdAt" DESC
    `;
    return rows.map(record);
  }

  async find(id: string): Promise<TodoRecord | null> {
    const rows = await this.sql<TodoRow[]>`
      SELECT id, title, completed, "createdAt" FROM todos WHERE id = ${id}
    `;
    const row = rows[0];
    return row ? record(row) : null;
  }

  async create(title: string): Promise<TodoRecord> {
    const rows = await this.sql<TodoRow[]>`
      INSERT INTO todos (title) VALUES (${title})
      RETURNING id, title, completed, "createdAt"
    `;
    const row = rows[0];
    if (!row) throw new Error("Todo insert returned no row");
    return record(row);
  }

  async update(id: string, input: { title?: string; completed?: boolean }): Promise<TodoRecord | null> {
    const current = await this.find(id);
    if (!current) return null;
    const title = input.title ?? current.title;
    const completed = input.completed ?? current.completed;
    const rows = await this.sql<TodoRow[]>`
      UPDATE todos SET title = ${title}, completed = ${completed}
      WHERE id = ${id}
      RETURNING id, title, completed, "createdAt"
    `;
    const row = rows[0];
    return row ? record(row) : null;
  }

  async remove(id: string): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`DELETE FROM todos WHERE id = ${id} RETURNING id`;
    return rows.length > 0;
  }
}
