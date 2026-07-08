import { error } from "@sveltejs/kit";

/** Roles that may reach the admin console. Kept as a set so custom roles can be
 *  added here (and, later, replaced by a permission check) without touching every
 *  page loader. better-auth stores a user's role(s) as a comma-separated string. */
const ADMIN_ROLES = ["admin"];

type WithRole = { role?: string | null } | null | undefined;

/** True when the user holds at least one admin role. */
export function isAdmin(user: WithRole): boolean {
  const roles = (user?.role ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  return roles.some((r) => ADMIN_ROLES.includes(r));
}

/** Guard an admin-only loader: throws 403 unless the user holds an admin role. */
export function requireAdmin(user: WithRole): void {
  if (!isAdmin(user)) error(403, "Admins only");
}
