---
"@podosoft/podokit": patch
---

Keep checking the API in the background while the web server treats it as unreachable. Before, the web server checked `GET /health` again only when a new request arrived, so after the API came back (for example after a restart or a deploy) the first page load or `/api` request still got `503 BACKEND_UNAVAILABLE` however long the API had been up. The managed `apps/web/src/lib/server/backend-proxy.ts` now checks every two seconds until the API answers, so requests go through as soon as it is back.
