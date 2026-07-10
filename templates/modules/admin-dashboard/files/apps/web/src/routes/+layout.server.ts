import type { LayoutServerLoad } from "./$types";
import { redirect } from "@sveltejs/kit";

// "/" is a public landing page. Auth pages send signed-in users to /admin, and
// the admin area requires a session. /maintenance is public so it renders while
// the rest of the site is held back.
const PUBLIC_PATHS = ["/", "/login", "/signup", "/forgot-password", "/reset-password", "/maintenance"];
const AUTH_PATHS = ["/login", "/signup", "/forgot-password", "/reset-password"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || (path !== "/" && pathname.startsWith(`${path}/`)));
}

export const load: LayoutServerLoad = async (event) => {
  const { locals, url } = event;
  const { pathname } = url;
  // Site settings were loaded once in hooks.server.ts.
  const site = locals.site;
  const isAdmin = locals.user?.role === "admin";

  // Maintenance mode holds everyone but admins on a maintenance page. /login and
  // /maintenance stay reachable so an admin can still sign in and turn it off.
  const maintenance = site?.maintenanceMode === "true";
  if (maintenance && !isAdmin && pathname !== "/maintenance" && pathname !== "/login") {
    redirect(303, "/maintenance");
  }
  if (!maintenance && pathname === "/maintenance") {
    redirect(303, "/");
  }
  // Registration closed from the admin Settings: send /signup back to /login.
  if (site?.allowSignup === "false" && pathname === "/signup") {
    redirect(303, "/login");
  }

  if (locals.user && AUTH_PATHS.includes(pathname)) {
    redirect(303, "/admin");
  }
  if (!locals.user && !isPublic(pathname)) {
    redirect(303, `/login?redirect=${encodeURIComponent(pathname)}`);
  }
  return { user: locals.user, locale: locals.locale, site };
};
