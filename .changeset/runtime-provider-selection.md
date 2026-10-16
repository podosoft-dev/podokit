---
"@podosoft/podokit": minor
---

Select a provider when the API starts. `DATABASE_PROVIDER`, `CACHE_PROVIDER`, `OBJECT_STORAGE_PROVIDER`, `EVENTS_PROVIDER`, and `JOBS_PROVIDER` replace the project's provider for one capability, so one build can run on PostgreSQL on a server and SQLite in a desktop shell without editing the managed `providers.ts`. An unknown value, or a provider whose module is not installed, fails startup. `providers.ts` now passes the project's selection through `providersFromEnvironment()` from the new `config/provider-selection.ts`, and `podo provider set` renders it the same way.
