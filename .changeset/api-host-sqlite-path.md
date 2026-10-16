---
"@podosoft/podokit": minor
---

Add `HOST` (the API's listen address, default `0.0.0.0`) and `SQLITE_PATH` (the SQLite file when `DATABASE_URL` is unset, default `./data/podokit.sqlite`) to the validated API environment, so apps no longer edit the managed `main.ts` or `database.ts` to bind to loopback or move the database. `databaseUrl()` takes the provider as an optional second argument.
