import { createAuthMiddleware } from "better-auth/api";
import { Pool } from "pg";

// A small dedicated pool for audit writes, kept separate from the auth pool.
const pool = new Pool({
  host: process.env.POSTGRES_HOST ?? "localhost",
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  user: process.env.POSTGRES_USER ?? "podokit",
  password: process.env.POSTGRES_PASSWORD ?? "podokit",
  database: process.env.POSTGRES_DB ?? "podokit",
});

// Mutating auth/admin endpoints worth auditing. better-auth is mounted as Express
// middleware and bypasses the NestJS AuditInterceptor, so these security events
// (login, role/ban changes, session revocation, user CRUD, ...) are recorded here.
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
  try {
    await pool.query(
      'INSERT INTO audit_logs ("userId", method, path, "statusCode", ip) VALUES ($1, $2, $3, $4, $5)',
      [userId, "POST", `/api/auth${ctx.path}`, 200, ip],
    );
  } catch {
    // Never block the auth flow on an audit write.
  }
});
