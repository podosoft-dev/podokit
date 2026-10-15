---
"@podosoft/podokit-api-client": minor
---

Send binary and stream request bodies. `post`, `put`, and `patch` send a `Blob`, `ArrayBuffer`, typed array, or `ReadableStream` as the raw body (streams with `duplex: "half"`), with the content type from the new `contentType` option, the Blob's type, or `application/octet-stream`. Every call accepts `{ contentType, headers, signal }`; JSON and `FormData` bodies are unchanged. `ApiError.retryAfterSeconds` exposes the `Retry-After` delay of a failed response.
