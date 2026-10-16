---
"@podosoft/podokit": minor
---

Add application-owned extension points to the web app so applications stop editing managed files. `apps/web/vite.extensions.ts` holds Vite options (`appViteConfig`, merged with `mergeConfig`) and SvelteKit options (`appSvelteKitConfig`). With `admin-dashboard`, `appHandle` in `apps/web/src/lib/server/app-hooks.ts` runs after `hooks.server.ts` loads the runtime context, `APP_ADMIN_NAV` in `apps/web/src/lib/admin/app-nav.ts` adds admin sidebar entries before module entries and Settings, and `APP_NON_INDEXABLE_PATHS` in `apps/web/src/lib/server/non-indexable-paths.ts` adds prefixes that answer with `X-Robots-Tag: noindex, nofollow`. `podo update` creates each file once and never overwrites it.
