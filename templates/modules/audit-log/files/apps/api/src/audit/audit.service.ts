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

export interface AuditServiceOptions {
  dialect: DatabaseProviderName;
  /** The admin on/off toggle. `record()` reads it before every write. */
  enabled: () => Promise<boolean>;
}

export class AuditService {
  private unregister?: () => void;
  private readonly dialect: DatabaseProviderName;
  private readonly enabled: () => Promise<boolean>;

  constructor(private readonly sql: SQL, options: AuditServiceOptions) {
    this.dialect = options.dialect;
    this.enabled = options.enabled;
  }

  connect(): void {
    this.unregister ??= setAuditRecorder((entry) => this.record(entry));
  }

  close(): void {
    this.unregister?.();
    this.unregister = undefined;
  }

  async record(entry: AuditEntry): Promise<void> {
    try {
      if (!(await this.enabled())) return;
      await this.insert([this.row(entry)]);
    } catch {
      // Audit persistence must never break the operation it describes.
    }
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

  private async insert(rows: AuditRow[]): Promise<void> {
    await this.sql`INSERT INTO "audit_logs" ${this.sql(rows, ...COLUMNS)}`;
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
  ): Promise<void> {
    await this.record({
      action,
      actorId: session.user.id,
      actorName: typeof session.user.name === "string" ? session.user.name : null,
      actorEmail: typeof session.user.email === "string" ? session.user.email : null,
      targetType: target.type ?? null,
      targetId: target.id ?? null,
      targetLabel: target.label ?? null,
      metadata: target.metadata ?? null,
      ip: request.headers.get("x-forwarded-for") ?? null,
    });
  }
}
