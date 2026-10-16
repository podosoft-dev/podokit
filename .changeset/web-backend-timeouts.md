---
"@podosoft/podokit": patch
---

Generated web apps no longer wait on an API that stops answering. Each server-side API call gives up after `BACKEND_TIMEOUT_MS` (2000 ms), and the `/api` proxy answers `504` `BACKEND_TIMEOUT` when no response headers arrive within `BACKEND_PROXY_TIMEOUT_MS` (30000 ms), or `503` `BACKEND_UNAVAILABLE` with `Retry-After: 2` instead of a bare `500` when it cannot reach the API. Once the API's `GET /health` does not answer either, waiting requests fail and new ones fail at once until the API answers again.
