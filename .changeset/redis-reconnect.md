---
"@podosoft/podokit": patch
---

Keep the `redis` module working across Redis outages. The API starts while Redis is down, reconnects in the background, and recovers after a Redis restart without its own restart; before, it exited at startup with `RedisError: Connection closed`, and a running API stayed unready after Redis came back because the client stopped reconnecting. Commands fail at once while disconnected, so the rate limiter answers `RATE_LIMIT_UNAVAILABLE` instead of waiting, and `RedisService.subscribe` resolves without Redis and restores its subscriptions on a fresh connection after every reconnect. The `redis` readiness check is registered by the module from the start.
