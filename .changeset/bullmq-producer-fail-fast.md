---
"@podosoft/podokit": patch
---

Fail BullMQ enqueues fast while Redis is unavailable. The API's queues used the workers' `maxRetriesPerRequest: null` connection settings, so `POST /jobs` and `POST /progress` waited until Redis returned. The API now adds and reads jobs over one supervised producer connection that fails at once while disconnected and after `REDIS_COMMAND_TIMEOUT_MS` without a reply, answering `503 JOBS_UNAVAILABLE` with `Retry-After`, and registers a `jobs` readiness check. Workers keep their blocking connections and reconnect with backoff from 250 ms up to 5 seconds. The `bullmq` module now requires BullMQ `^5.57.0`.
