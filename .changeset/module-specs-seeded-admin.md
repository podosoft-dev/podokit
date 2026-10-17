---
"@podosoft/podokit": patch
---

Sign the object storage and SSE specs in as the administrator through the new `tests/helpers/seeded-admin.ts`, which reads the application's `app-accounts.ts` and `E2E_*` values, instead of a hard-coded `admin@example.com` and password, and extend the check that managed specs name seeded accounts only through the account helpers to `E2E_*` variables and the external module packages.
