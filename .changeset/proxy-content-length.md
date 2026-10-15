---
"@podosoft/podokit": patch
---

Keep `Content-Length` on responses relayed by the web app's `/api` proxy. Bun sends a streamed body, a `fetch()` response body included, with chunked encoding and drops the length once it is more than a few KiB, so profile images, favicons, and larger JSON responses reached the browser chunked even when the API sent their length. The managed `backend-proxy.ts` now reads an uncompressed body of up to 2 MiB (`IN_MEMORY_RESPONSE_BYTES`) with a known length before relaying it, and streams larger bodies through.
