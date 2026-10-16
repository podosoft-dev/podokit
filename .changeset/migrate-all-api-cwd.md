---
"@podosoft/podokit": patch
---

`apps/api/scripts/run-migrations.mjs`, the launcher behind `migrate:all`, runs the migration in `apps/api` wherever it is started from. Bun reads decorator settings such as `experimentalDecorators` from the `tsconfig.json` of the working directory, so started from the repository root, TypeORM entities with decorators failed to load, and the data source looked for `.env` and the migrations in the wrong directory.
