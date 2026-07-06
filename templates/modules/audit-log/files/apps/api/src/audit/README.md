# Audit log

Every audit entry goes through **one pipeline** — `AuditService` → the
`audit_logs` table — so all entries share one shape and one write path,
regardless of where they came from.

## Sources (built in)

| Source | File | Captures |
| --- | --- | --- |
| NestJS interceptor | `audit.interceptor.ts` | Mutating requests (`POST/PUT/PATCH/DELETE`) to **your own** API routes. |
| better-auth hook | `audit-hook.ts` | **Auth/admin actions** (login, ban, role change, session revoke, user CRUD, …). better-auth is mounted as middleware and bypasses the interceptor, so it is caught here. |

Both call the same recorder, so you manage a single, consistent log.

## Record a custom event

From anywhere (including code outside Nest's DI):

```ts
import { recordAudit } from "./audit/audit-events";

await recordAudit({
  method: "EVENT",
  path: "todo.deleted",
  statusCode: 200,
  userId: currentUserId,
  metadata: { todoId }, // any JSON — stored in the jsonb `metadata` column
});
```

Or, inside a Nest provider, inject the service:

```ts
constructor(private readonly audit: AuditService) {}
// ...
await this.audit.record({ method: "EVENT", path: "invoice.paid", statusCode: 200, userId, metadata });
```

`recordAudit` / `AuditService.record` never throw — a failed audit write will
never break the request it describes.

## Customize

- **What is audited:** edit `AUDITED_METHODS` in `audit.interceptor.ts` (your API
  routes) and `AUDITED_PATHS` in `audit-hook.ts` (auth/admin endpoints).
- **Extra context:** put anything in `metadata` (a `jsonb` column).
- **Schema:** add columns to `audit-log.entity.ts` and a matching migration; keep
  the `AuditEntry` type in `audit-events.ts` in sync.
- **Reading:** `GET /audit-logs` returns the latest 50 (admin only). Extend
  `audit.controller.ts` for filtering/pagination as needed.
