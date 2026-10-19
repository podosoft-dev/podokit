---
"@podosoft/podokit": patch
---

Recover a development API whose automatic `migrate:all` failed at start, for example while PostgreSQL was down. Its `migrations` readiness check failed until the API restarted, so `/api/health/ready` stayed 503 after the database came back. The generated `apps/api/src/database/development-migrations.ts` now retries `migrate:all` in the background after 1 s, then after twice the previous wait, up to every 10 s, and removes the check once a run succeeds; the retries stop when the API shuts down. `apps/api/src/main.ts` passes the readiness service and the shutdown signal to it.
