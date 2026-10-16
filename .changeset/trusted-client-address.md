---
"@podosoft/podokit": patch
---

Stop trusting a caller-controlled header for client addresses. The generated API resolves each request's address once, from the socket peer and `TRUSTED_PROXY_HOPS` / `TRUSTED_PROXY_HEADER` (formerly the rate-limit module's `RATE_LIMIT_TRUSTED_PROXY_HOPS` / `RATE_LIMIT_PROXY_HEADER`, now refused), records it in the `x-podokit-client-address` request header over any value the caller sent, and uses it for Better Auth sessions and limits, audit entries, and rate limits. The audit-log module stored `X-Forwarded-For` as received, so a caller could write any address into the audit trail. Generated configuration and new deployment profiles set `TRUSTED_PROXY_HOPS=1` for the web proxy or gateway in front of the API.
