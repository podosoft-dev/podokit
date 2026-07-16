import type { LayoutServerLoad } from "./$types";
import { redirect } from "@sveltejs/kit";
import { safeAuthRedirect } from "$lib/auth-redirect";

// "/" is a public landing page. Auth pages return signed-in users to their safe
// requested page, and the admin area requires a session. /maintenance is public
// so it renders while the rest of the site is held back.
const PUBLIC_PATHS = [
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/pending-approval",
  "/maintenance",
  // Modules add their public (no-session) page prefixes here.
  // podokit:begin:public-paths
  // podokit:end:public-paths
];
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
    const returnTo = safeAuthRedirect(url.searchParams.get("redirect"));
    redirect(303, `/login?redirect=${encodeURIComponent(returnTo)}`);
  }

  if (locals.user && AUTH_PATHS.includes(pathname)) {
    redirect(303, safeAuthRedirect(url.searchParams.get("redirect")));
  }
  if (!locals.user && !isPublic(pathname)) {
    redirect(303, `/login?redirect=${encodeURIComponent(`${pathname}${url.search}`)}`);
  }
  return { user: locals.user, locale: locals.locale, site };
};
