---
"@podosoft/podokit": patch
---

Stop holding auth requests for a configuration refresh that PostgreSQL does not answer. The refresh that runs before Better Auth on a request waited as long as a query may wait during an outage, so sign-in answered `503` only after two timeouts. A request now waits for it at most `READINESS_CHECK_TIMEOUT_MS` and is served by the current configuration while the refresh finishes in the background.
