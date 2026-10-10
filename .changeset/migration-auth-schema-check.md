---
"@podosoft/podokit": patch
---

Skip Better Auth's startup schema check in the generated migration runner, so `migrate:all` no longer logs `Database schema mismatch` for the schema it is about to migrate. API servers keep validating the schema at startup.
