---
"@podosoft/podokit-runtime": minor
"@podosoft/podokit": minor
---

Add rate-limit route profiles. The runtime exports `RATE_LIMIT_ROUTES` with the `RateLimitRoute`, `RateLimitProfile`, and `RateLimitRouteRegistry` contracts, and the rate-limit module registers the registry and re-exports the key. `register({ method?, pathPrefix, profile })` gives a path prefix its own budget (`{ name, limit, ttlSeconds? }`) or `"exempt"`; the most specific prefix wins, then a route with a method, then the latest registration. The general, authentication, and runtime budgets are now registered routes, with the same limits as before. Modules resolve the registry with `tryResolve`, so they work without rate limiting installed.
