---
"@podosoft/podokit": patch
---

Bound every Redis command the API sends with `REDIS_COMMAND_TIMEOUT_MS` (default `1000`). While Redis kept the connection open without answering, as a paused container does, cache reads and writes through `RedisService` and the Redis `CACHE` store waited indefinitely and the connection still looked healthy. A command now fails with `RedisCommandTimeoutError`, and its connection is closed and reopened by the supervisor. The `events-redis` transport bounds publishing and its subscription the same way, the demo `/cache` endpoints answer `503 CACHE_UNAVAILABLE`, and `RedisService.command(...)` bounds commands the service does not wrap.
