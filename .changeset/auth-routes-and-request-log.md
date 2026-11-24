---
"@podosoft/podokit": patch
---

Answer an unknown API path with the not-found error envelope for signed-in users too. Better Auth was mounted at the root, so it answered every unmatched request with an empty 404 that bypassed the application's error handling; it now receives only its base path and the root OAuth discovery documents. The request log also records the status of a Response a handler returns, instead of 200.
