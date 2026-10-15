---
"@podosoft/podokit": minor
---

Load the session and site settings only for responses that can use them. The admin-dashboard `hooks.server.ts` now decides through the managed `#lib/server/runtime-context.ts`: pages, page data, form actions, remote functions, and SvelteKit's 404 page get both, while the `/api` proxy, a missing subresource, and prerendering skip both API calls. A signed-in visitor on a missing page no longer loops between the page and `/login`. An application-owned `apps/web/src/lib/server/asset-paths.ts` (`APP_ASSET_PATHS`) lists the prefixes of `+server.ts` endpoints that serve files or feeds; those endpoints answer without the two API calls, and a page under a listed prefix keeps its sign-in and maintenance checks. `podo update` creates the file once and never overwrites it.
