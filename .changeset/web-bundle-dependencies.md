---
"@podosoft/podokit": patch
---

Bundle the web server's runtime dependencies into its production build. With the stable SvelteKit adapter, every `dependency` in `apps/web/package.json` stayed out of the server bundle, and the web image copies only the build, so Bun fetched those packages from npm (unpinned) each time the server started, and a web container without network access could not start (`Cannot find package 'clsx'`). The managed `vite.config.ts` now lists them in `ssr.noExternal`. Applications created with 1.7.6 or later should update and rebuild their web image.
