---
"@podosoft/podokit": patch
---

Make the `rate-limit` module's spec read each budget's limit from the API's `RateLimit-Limit` header instead of expecting the module defaults when the runner's environment does not set them, so it passes against a stack with other limits, such as the development example's `RATE_LIMIT_MAX=100` or raised local limits. Limits set in the runner's environment are still checked, counts compared across requests are checked again in a new window when a short `RATE_LIMIT_TTL` ends in between, the session read test skips with its reason when the authentication limit is not below the runtime one, and `E2E_SKIP_RATE_LIMIT=true` still skips the file.
