---
"@podosoft/podokit": patch
---

Make UI test failures in generated applications diagnosable after the fact. The `admin-dashboard` hydration helpers (`ready`, `hydrated` in `tests/helpers/hydration.ts`) no longer wait for the 30-second test timeout on a page that cannot hydrate: they fail at once on SvelteKit's static error page (`src/error.html`), and five seconds after an uncaught page error when the page has still not hydrated, naming the page's URL, status, title, and text and the page errors, console errors, and failed requests seen while waiting. SvelteKit renders that error page in the browser when hydration fails and the root error page cannot load either, for example after a failed request for a module or message catalog, so the server answers 200 and has nothing to log; the managed `vite.config.ts` now sets `server.forwardConsole` so that `vite dev` prints the browser's uncaught errors and `console.error` messages with its own output and container log.
