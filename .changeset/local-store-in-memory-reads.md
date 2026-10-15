---
"@podosoft/podokit-runtime": minor
"@podosoft/podokit": patch
---

Keep `Content-Length` for local objects up to 2 MiB. Bun keeps the length that `objectResponse` sets only for a body held in memory or read from a file, such as `new Blob([bytes]).stream()`, and sends any other `ReadableStream`, including a `fetch()` response body, chunked (oven-sh/bun#10507). `LocalObjectStore.get()` now reads objects up to the new `IN_MEMORY_READ_BYTES` (2 MiB) whole before it resolves, opening the file with `O_NOFOLLOW` and checking that the path still holds the described file before and after the read, and returns them as an in-memory body; a file replaced during that read is described again. Larger objects still stream in 64 KiB chunks from the first read and go out chunked. The `object-storage-s3` module now takes its 2 MiB limit from `IN_MEMORY_READ_BYTES`.
