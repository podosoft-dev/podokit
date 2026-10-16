---
"@podosoft/podokit": patch
---

Make the generated `apps/api/src/database/pool-guard.spec.ts` type-check with every `@types/bun` version the template allows. With `@types/bun` 1.3.9 through 1.4.2, the `expect()` overload for a missing value made TypeScript infer two awaited queries as `undefined`, so `bun run lint` failed in new apps. The two queries now declare their row types.
