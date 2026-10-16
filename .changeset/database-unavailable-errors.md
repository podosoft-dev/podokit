---
"@podosoft/podokit": patch
---

`isDatabaseUnavailable` also treats refused, reset and unreachable connections, pg's "Connection terminated unexpectedly", and the server-shutdown and connection-exception SQLSTATEs (57P01, 57P02, 57P03, class 08) as the database being unavailable, so those failures answer 503 `DATABASE_UNAVAILABLE` instead of 500.
