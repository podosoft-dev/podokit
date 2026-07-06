// One audit pipeline for the whole app. Every source — the NestJS interceptor,
// the better-auth hook, and your own code — records through here, so all entries
// share the same shape and the same write path (AuditService → audit_logs).

export type AuditEntry = {
  userId?: string | null;
  method: string;
  path: string;
  statusCode: number;
  ip?: string | null;
  metadata?: Record<string, unknown> | null;
};

type Recorder = (entry: AuditEntry) => Promise<void>;
let recorder: Recorder | null = null;

// AuditService registers the real recorder on startup. This registry lives
// outside Nest's DI so code that runs outside the container (the better-auth
// hook, background jobs, etc.) can still write through the one pipeline.
export function setAuditRecorder(fn: Recorder): void {
  recorder = fn;
}

// Record a custom audit event from anywhere. Awaits the write; a no-op until the
// AuditService has started. Example:
//   await recordAudit({ method: "EVENT", path: "todo.deleted", statusCode: 200,
//                       userId, metadata: { todoId } });
export async function recordAudit(entry: AuditEntry): Promise<void> {
  if (recorder) await recorder(entry);
}
