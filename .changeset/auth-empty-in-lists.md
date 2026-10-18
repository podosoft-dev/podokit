---
"@podosoft/podokit": patch
---

Answer an organization's `list-members` with an empty list instead of a 500 on PostgreSQL when a filter or a page matches no member: the `auth` module now runs Better Auth's PostgreSQL queries through a Kysely instance that sends an empty `in` list as `1 = 0` and an empty `not in` list as `1 = 1`, where Better Auth's adapter sent `IN ()`. Generated APIs depend on `kysely` directly.
