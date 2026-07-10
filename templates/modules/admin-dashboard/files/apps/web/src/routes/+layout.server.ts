import type { LayoutServerLoad } from "./$types";
import { redirect } from "@sveltejs/kit";
import { serverApiClient } from "$lib/server/api";
import type { SiteSettings } from "$lib/site.svelte";

// "/" is a public landing page. Auth pages send signed-in users to /admin, and
// the admin area requires a session.
const PUBLIC_PATHS = ["/", "/login", "/signup", "/forgot-password", "/reset-password"];
const AUTH_PATHS = ["/login", "/signup", "/forgot-password", "/reset-password"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || (path !== "/" && pathname.startsWith(`${path}/`)));
}

export const load: LayoutServerLoad = async (event) => {
  const { locals, url } = event;
  const { pathname } = url;
  if (locals.user && AUTH_PATHS.includes(pathname)) {
    redirect(303, "/admin");
  }
  if (!locals.user && !isPublic(pathname)) {
    redirect(303, `/login?redirect=${encodeURIComponent(pathname)}`);
  }
  // Public site branding (name/favicon), applied to the browser by the layout.
  let site: SiteSettings | null = null;
  try {
    site = await serverApiClient(event).get<SiteSettings>("/site/settings");
  } catch {
    site = null;
  }
  return { user: locals.user, locale: locals.locale, site };
};
