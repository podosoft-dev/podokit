import { createAuthMiddleware } from "better-auth/api";
import { recordAudit } from "./audit-events";

// Mutating auth/admin endpoints worth auditing. better-auth is mounted as Express
// middleware and bypasses the NestJS AuditInterceptor, so these security events
// (login, role/ban changes, session revocation, user CRUD, ...) are caught here
// and recorded through the same AuditService pipeline as everything else.
const AUDITED_PATHS = new Set([
  "/sign-in/email",
  "/sign-up/email",
  "/sign-out",
  "/change-password",
  "/change-email",
  "/reset-password",
  "/update-user",
  "/delete-user",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
  "/two-factor/enable",
  "/two-factor/disable",
  "/admin/create-user",
  "/admin/update-user",
  "/admin/remove-user",
  "/admin/set-role",
  "/admin/set-user-password",
  "/admin/ban-user",
  "/admin/unban-user",
  "/admin/revoke-user-session",
  "/admin/revoke-user-sessions",
  "/admin/impersonate-user",
  "/admin/stop-impersonating",
]);

// The top-level `hooks.after` is a single middleware; it runs only on success,
// so it records completed actions (200). We match the audited paths inside.
export const auditAfterHook = createAuthMiddleware(async (ctx) => {
  if (!AUDITED_PATHS.has(ctx.path)) return;
  const context = ctx.context as { session?: { user?: { id?: string } }; newSession?: { user?: { id?: string } } };
  const userId = context.session?.user?.id ?? context.newSession?.user?.id ?? null;
  const ip = ctx.headers?.get("x-forwarded-for") ?? null;
  await recordAudit({ userId, method: "POST", path: `/api/auth${ctx.path}`, statusCode: 200, ip });
});
