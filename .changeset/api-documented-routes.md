---
"@podosoft/podokit": minor
---

Add the application-owned `apps/api/src/core/api-contract.extensions.ts` with `APP_DOCUMENTED_ROUTES`. `bun run contract` fails when one of those operations is not registered or missing from the OpenAPI document, so apps stop editing the managed `verify-api-contract.ts` and `api-contract.ts` to check their own routes. Both `{id}` and `:id` parameter syntax are accepted.
