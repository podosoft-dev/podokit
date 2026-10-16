---
"@podosoft/podokit": minor
---

Stop losing migrations between the build and the database. The API build pins compiled migrations to `dist/migrations/<file>.js`, removes stale ones, fails unless the output matches `src/migrations` with one migration class per file, and writes `dist/migrations/migrations.json`. In production the migrators run exactly the listed files, refuse to run without the list, and fail when they load fewer migrations than expected; the API refuses to start without the list, and `GET /health/ready` reports a `migrations` check that stays down while a listed migration is missing from the database. `bun run migrate:list` prints the migrations a build would run, without a database.
