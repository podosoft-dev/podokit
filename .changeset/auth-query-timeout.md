---
"@podosoft/podokit": patch
---

Bound the auth module's PostgreSQL queries with `DB_QUERY_TIMEOUT_MS` (default `10000`). While PostgreSQL kept its connections open without answering, sign-in and session lookups waited indefinitely, and a connection whose query timed out would have been reused by Kysely behind the missing reply. The auth pool now fails such a query, discards its connection, and opens a new one, so Better Auth endpoints answer `503 DATABASE_UNAVAILABLE`. Migrations and `admin:bootstrap` import `./auth/maintenance-command` first, which replaces `./auth/skip-schema-validation`, and run without the timeout.
