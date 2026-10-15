---
"@podosoft/podokit-runtime": patch
---

`LocalObjectStore` reads objects up to 2 MiB whole, so responses built from them keep their `Content-Length`. Bun sends a `ReadableStream` body with chunked encoding and drops an explicit length unless the stream enqueues and closes in a single pull; larger objects still stream in 64 KiB chunks.
