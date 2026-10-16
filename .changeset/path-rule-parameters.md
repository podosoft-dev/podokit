---
"@podosoft/podokit": patch
"@podosoft/podokit-runtime": patch
---

Path prefixes in the rate-limit module's route profiles (`RATE_LIMIT_ROUTES`), `APP_BODY_LIMITS`, and `APP_PROXY_TIMEOUTS` take `:name` parameters that match exactly one non-empty path segment, such as `/hosts/:hostId/file-transfers` on the API and `/api/hosts/:hostId/file-transfers` on the web proxy. The most specific prefix wins: more segments, then, from the left, a literal segment over a parameter, then the existing tie-breakers. Wildcards, `.` or `..` segments, and malformed names are rejected, and the web lists reject two prefixes that cover the same paths.
