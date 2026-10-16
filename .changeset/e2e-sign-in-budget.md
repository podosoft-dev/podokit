---
"@podosoft/podokit": patch
---

Keep the generated account sessions specs and the `rate-limit` spec from spending the per-address sign-in budget: only their first sign-in or sign-up is anonymous, and the rest carry that session, which the rate limiter counts on its own.
