---
"@podosoft/podokit": minor
---

Let apps pass their own headers through the `/api` proxy. Generated apps get an application-owned `apps/web/src/lib/server/proxy-headers.ts` with `APP_FORWARDED_REQUEST_HEADERS` and `APP_RELAYED_RESPONSE_HEADERS`, which the managed `backend-proxy.ts` merges into its allowlists (lowercased, deduplicated, and rejecting hop-by-hop, framing, `host`, `set-cookie`, and client address headers). `podo update` creates the file once in existing apps and never overwrites it.
