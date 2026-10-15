---
"@podosoft/podokit": minor
---

Let apps cap request bodies per API route. Generated apps get an application-owned `apps/web/src/lib/server/body-limits.ts` with `APP_BODY_LIMITS` (`{ pathPrefix, maxBytes }` entries under `/api/`), which the managed `/api` proxy enforces by rejecting a larger `Content-Length` or counting a streamed body, answering 413 `PAYLOAD_TOO_LARGE` with the standard error envelope. `BODY_SIZE_LIMIT` remains the ceiling for every web route; uploads above it use direct API paths. `podo update` creates the file once in existing apps and never overwrites it.
