---
"@podosoft/podokit": patch
---

Keep the `/api` proxy from cutting a request without a deadline after 300 seconds. Bun's `fetch` gave up on a silent API connection after its idle timeout (`BUN_CONFIG_HTTP_IDLE_TIMEOUT`, 300 seconds by default) even when `APP_PROXY_TIMEOUTS` set `timeoutMs: null`, and the browser got `503` `BACKEND_UNAVAILABLE` although the API was still working. The managed `backend-proxy.ts` now turns that timeout off for a route without a deadline and for a deadline of 300 seconds or more, so the deadline, the `GET /health` checks, and the browser alone end the wait; shorter deadlines keep Bun's default.
