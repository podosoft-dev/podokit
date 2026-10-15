---
"@podosoft/podokit": patch
---

Recover the API's Bun SQL pool when PostgreSQL keeps its connections open without answering, as a paused container, a frozen VM, or a network partition does. Bun SQL has no query timeout and cannot close a single pool connection, so such queries waited until the server answered again. A query or transaction still pending after `DB_QUERY_TIMEOUT_MS` (default `10000`) now makes the API check the server on a new connection; when that check fails within `READINESS_CHECK_TIMEOUT_MS`, the API replaces the pool, the waiting requests answer `503 DATABASE_UNAVAILABLE`, and the supervisor logs the outage and its end. Slow queries on a server that still answers keep running, and migrations are not affected.
