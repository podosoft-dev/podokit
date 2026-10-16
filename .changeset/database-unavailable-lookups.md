---
"@podosoft/podokit": patch
---

`isDatabaseUnavailable` also recognizes a database host that does not resolve (`ENOTFOUND`) or whose lookup times out (`ETIMEOUT` in Bun, `EAI_AGAIN` in Node), pg's "Connection terminated", "Client was closed and is not queryable" and "Client has encountered a connection error and is not queryable", the per-address errors of an `AggregateError`, and the `driverError` of TypeORM's `QueryFailedError`, so those failures answer 503 `DATABASE_UNAVAILABLE` instead of 500.
