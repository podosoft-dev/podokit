import type { LayoutServerLoad } from "./$types";
import { redirect } from "@sveltejs/kit";

const PUBLIC_PATHS = ["/login", "/signup", "/forgot-password", "/reset-password"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export const load: LayoutServerLoad = ({ locals, url }) => {
  if (url.pathname === "/") {
    redirect(303, locals.user ? "/dashboard" : "/login");
  }
  if (locals.user && isPublic(url.pathname)) {
    redirect(303, "/dashboard");
  }
  if (!locals.user && !isPublic(url.pathname)) {
    redirect(303, `/login?redirect=${encodeURIComponent(url.pathname)}`);
  }
  return { user: locals.user };
};
