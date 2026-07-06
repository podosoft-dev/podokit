import { createAuthMiddleware } from "better-auth/api";
import { recordAudit } from "./audit-events";

// Map mutating auth/admin endpoints to semantic action codes. better-auth is
// mounted as middleware and bypasses the NestJS interceptor, so these security
// events are caught here and recorded through the same pipeline.
const ACTIONS: Record<string, string> = {
  "/sign-in/email": "auth.login",
  "/sign-up/email": "auth.signup",
  "/sign-out": "auth.logout",
  "/change-password": "auth.password_change",
  "/change-email": "auth.email_change",
  "/reset-password": "auth.password_reset",
  "/update-user": "account.update",
  "/delete-user": "account.delete",
  "/revoke-session": "session.revoke",
  "/revoke-sessions": "session.revoke_all",
  "/revoke-other-sessions": "session.revoke_others",
  "/two-factor/enable": "2fa.enable",
  "/two-factor/disable": "2fa.disable",
  "/admin/create-user": "user.create",
  "/admin/update-user": "user.update",
  "/admin/remove-user": "user.delete",
  "/admin/set-role": "user.role_change",
  "/admin/set-user-password": "user.password_set",
  "/admin/ban-user": "user.ban",
  "/admin/unban-user": "user.unban",
  "/admin/revoke-user-session": "user.session_revoke",
  "/admin/revoke-user-sessions": "user.session_revoke_all",
  "/admin/impersonate-user": "user.impersonate",
  "/admin/stop-impersonating": "user.stop_impersonate",
};

// The top-level `hooks.after` is a single middleware; it runs only on success,
// so it records completed actions.
export const auditAfterHook = createAuthMiddleware(async (ctx) => {
  const action = ACTIONS[ctx.path];
  if (!action) return;
  const context = ctx.context as {
    session?: { user?: { id?: string; name?: string; email?: string } };
    newSession?: { user?: { id?: string; name?: string; email?: string } };
  };
  const actor = context.session?.user ?? context.newSession?.user;
  const body = (ctx.body ?? {}) as { email?: string; userId?: string };
  await recordAudit({
    action,
    actorId: actor?.id ?? null,
    actorName: actor?.name ?? null,
    actorEmail: actor?.email ?? null,
    targetId: body.userId ?? null,
    targetLabel: body.email ?? body.userId ?? null,
    ip: ctx.headers?.get("x-forwarded-for") ?? null,
  });
});
