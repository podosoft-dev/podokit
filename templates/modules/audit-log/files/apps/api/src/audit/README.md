# Audit log

An append-only trail of **who did what, to which resource, when** — the
actor / action / target model. Every entry flows through one pipeline
(`AuditService` → the `audit_logs` table) so they all share one shape.

## What gets recorded

Nothing is recorded automatically except the built-in **auth/admin actions**
(login, user create/update/delete, ban, role change, session revoke, ...),
which the better-auth hook (`audit-hook.ts`) maps to semantic action codes like
`user.create` and `auth.login`. Everything else is **opt-in** — you decide what
matters.

## Audit your own Elysia routes

```ts
const session = await auth.requireSession(request);
const todo = await todos.create(body);
await audit.recordRequest("todo.create", request, session, {
  type: "todo",
  id: todo.id,
  label: todo.title,
});
return todo;
```

Call `recordRequest` only after the operation succeeds. It attaches the actor and
request address, then writes the target metadata through the shared pipeline.

## Record from anywhere in code

```ts
import { recordAudit } from "../audit/audit-events";

await recordAudit({
  action: "invoice.paid",
  actorId, actorName, actorEmail,
  targetType: "invoice", targetId: invoice.id, targetLabel: invoice.number,
  metadata: { amount },
});
```

Resolve `AUDIT` from the application service registry to call
`audit.record({ ... })`. Audit writes never break the request.

## Fields (`AuditEntry`)

`action` (semantic code), `actorId/actorName/actorEmail` (denormalized so the log
survives renames/deletes), `targetType/targetId/targetLabel`, `ip`, `metadata`
(jsonb, free-form), `createdAt`.

## Customize

- **Auth actions:** edit the `ACTIONS` map in `audit-hook.ts`.
- **Your routes:** call `AuditService.recordRequest()` after successful operations.
- **Schema:** add columns with a migration, and keep the
  `AuditEntry` type in `audit-events.ts` in sync.
- **Reading:** `GET /audit-logs` returns the latest 50 (admin only); extend the
  Elysia plugin in `audit.module.ts` for filtering or pagination.
