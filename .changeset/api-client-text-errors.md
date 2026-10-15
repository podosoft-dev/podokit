---
"@podosoft/podokit-api-client": patch
---

Report an error response whose body is not JSON, such as a gateway's 502 page or a plain-text 413, as an `ApiError` with code `HTTP_ERROR`, its status, and `retryAfterSeconds`, instead of throwing a `SyntaxError` while parsing it.
