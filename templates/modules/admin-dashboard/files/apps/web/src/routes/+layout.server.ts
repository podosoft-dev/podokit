import type { LayoutServerLoad } from "./$types";
import { redirect } from "@sveltejs/kit";

// "/" is a public landing page. Auth pages send signed-in users to /admin, and
// the admin area requires a session.
const PUBLIC_PATHS = ["/", "/login", "/signup", "/forgot-password", "/reset-password"];
const AUTH_PATHS = ["/login", "/signup", "/forgot-password", "/reset-password"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || (path !== "/" && pathname.startsWith(`${path}/`)));
}

export const load: LayoutServerLoad = ({ locals, url }) => {
  const { pathname } = url;
  if (locals.user && AUTH_PATHS.includes(pathname)) {
    redirect(303, "/admin");
  }
  if (!locals.user && !isPublic(pathname)) {
    redirect(303, `/login?redirect=${encodeURIComponent(pathname)}`);
  }
  return { user: locals.user, locale: locals.locale };
};
