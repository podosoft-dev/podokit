---
"@podosoft/podokit": minor
---

Let apps set the `/api` proxy's response deadline per route. Generated apps get an application-owned `apps/web/src/lib/server/proxy-timeouts.ts` with `APP_PROXY_TIMEOUTS` (`{ pathPrefix, timeoutMs }` entries under `/api/`, longest prefix wins, `null` for no deadline), which the managed `backend-proxy.ts` uses instead of `BACKEND_PROXY_TIMEOUT_MS`. The proxy repeats its `GET /health` check while it waits, so a route without a deadline still fails with `503` `BACKEND_UNAVAILABLE` when the API stops answering. `podo update` creates the file once in existing apps and never overwrites it.
