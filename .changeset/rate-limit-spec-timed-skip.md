---
"@podosoft/podokit": patch
---

Make the `rate-limit` module's spec decide from time instead of a fixed limit whether it can send a budget's worth of requests. The 429 test skipped only above a general limit of 10,000, so at a raised local limit such as `RATE_LIMIT_MAX=6000` it failed on the 30-second test timeout. It and the session read test now time their first 50 requests and skip, naming the pace and the time needed, when the rest would take more than half of the time the test has left; at the default limits they run as before.
