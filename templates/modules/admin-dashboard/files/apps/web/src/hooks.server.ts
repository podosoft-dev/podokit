import type { Handle } from "@sveltejs/kit";
import { serverApiClient } from "$lib/server/api";
import { resolveLocale } from "$lib/i18n/messages";
import { applySearchIndexingHeaders } from "$lib/server/search-indexing";
import type { SiteSettings } from "$lib/site.svelte";

export const handle: Handle = async ({ event, resolve }) => {
  // Static assets and API proxy requests do not render application layouts.
  // Avoid multiplying settings/session API calls for every asset and proxied
  // request; page and data routes still receive the complete runtime context.
  if (event.route.id === null || event.url.pathname.startsWith("/api/")) {
    const response = await resolve(event);
    return applySearchIndexingHeaders(response, event.url.pathname);
  }

  // Public site settings (branding, locale/timezone defaults, maintenance, …),
  // loaded once here and reused by the layout load. A visitor with no locale
  // cookie falls back to the admin-configured site locale, then the app default.
  let site: SiteSettings | null = null;
  try {
    site = await serverApiClient(event).get<SiteSettings>("/site/settings");
  } catch {
    site = null;
  }
  event.locals.site = site;
  event.locals.locale = resolveLocale(event.cookies.get("locale") ?? site?.locale ?? undefined);
  try {
    const { data } = await serverApiClient(event).auth.getSession();
    event.locals.user = (data?.user as App.Locals["user"]) ?? null;
    event.locals.session = data?.session
      ? { id: data.session.id, impersonatedBy: (data.session as { impersonatedBy?: string | null }).impersonatedBy ?? null }
      : null;
  } catch {
    event.locals.user = null;
    event.locals.session = null;
  }
  const response = await resolve(event, {
    transformPageChunk: ({ html }) => html.replace('lang="en"', `lang="${event.locals.locale}"`),
  });
  return applySearchIndexingHeaders(response, event.url.pathname);
};
