---
"@podosoft/podokit": minor
---

Harden generated apps at runtime. The web proxy now aborts the API request when the client disconnects, relays cache and download headers, and forwards encoded paths unchanged. Readiness re-checks the database on every probe with per-check timeouts and a short shared cache, and API probes get a two-second timeout. Database pool size and connection timeouts are configurable, and an exhausted pool answers 503 `DATABASE_UNAVAILABLE`. The container dev stack caps every service's memory. Demo storage routes are admin-only under a `demo/` prefix, uploads are presigned only for their uploader or an admin, and local downloads require a signed URL and never render script.
