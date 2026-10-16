---
"@podosoft/podokit": patch
---

Derive the rendered `CONNECTION_IDLE_TIMEOUT` and `API_IDLE_TIMEOUT` from the application's `APP_PROXY_TIMEOUTS` as well as `BACKEND_PROXY_TIMEOUT_MS`: `0` when an entry has `timeoutMs: null`, otherwise the longest wait's whole seconds plus 5. PodoKit reads `apps/web/src/lib/server/proxy-timeouts.ts` as text without running it, and `podo deploy plan` fails with the line it stopped at when an entry is not a literal. `podo deploy doctor` fails a `CONNECTION_IDLE_TIMEOUT` set in `runtimeConfig` that cannot cover the longest wait, since the web server would refuse to start, and warns about such an `API_IDLE_TIMEOUT`.
