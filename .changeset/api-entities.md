---
"@podosoft/podokit": minor
---

Add the application-owned `apps/api/src/database/entities.ts` (`APP_ENTITIES`), which the migration data source loads, and enable `experimentalDecorators` and `emitDecoratorMetadata` in the API's `tsconfig.json`, so apps stop editing `data-source.ts` and `tsconfig.json` for TypeORM entities. `migration:generate` works again: the `typeorm` script runs the CLI on Bun, `data-source.ts` exports only `appDataSource`, and `ts-node` is no longer a dependency.
