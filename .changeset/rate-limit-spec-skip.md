---
"@podosoft/podokit": patch
---

`E2E_SKIP_RATE_LIMIT=true` skips the rate-limit module's Playwright spec, so a local stack with raised limits can run the rest of the suite in one go and run that file separately against the default limits.
