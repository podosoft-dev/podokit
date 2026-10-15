---
"@podosoft/podokit": patch
---

Start the generated API while PostgreSQL is unreachable. The service registry gains `services.supervise(name, connection)`: startup makes one connection attempt, then the server listens and the registry reconnects in the background with backoff from 250 ms up to 5 seconds, logging once per state change. The core database and the `jobs-local` worker use it, so the API answers `/health` with 200 and `/health/ready` with 503 until the database is back and then becomes ready without a restart, instead of exiting with `ERR_POSTGRES_CONNECTION_REFUSED`. The `/health/ready` 503 message names the checks that are down.
