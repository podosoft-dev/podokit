---
"@podosoft/podokit": patch
---

Keep the `events-redis` transport delivering across Redis outages. The API starts while Redis is down, handlers register without waiting for Redis, and the registry reconnects the transport in the background and subscribes its channel again on a fresh connection after every drop, because Bun restores neither. SSE events and settings change events from other replicas arrive again once Redis is back, open SSE streams receive `resync`, publishing fails at once with 503 `EVENTS_TRANSPORT_UNAVAILABLE` while disconnected, and the `events` readiness check reports the transport down until it is subscribed.
