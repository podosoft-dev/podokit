---
"@podosoft/podokit": patch
---

Let `dependencies.postgres.appPools` entries in a deployment profile state a fixed `size` instead of a `sizeKey`, so `podo deploy doctor` and `podo deploy plan` count application pools whose size the code sets, such as a TypeORM data source with the `pg` default of 10, instead of rejecting them and under-counting the connections.
