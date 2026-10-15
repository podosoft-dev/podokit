---
"@podosoft/podokit-runtime": patch
---

Document that Bun keeps the `content-length` set by `objectResponse` only for a body held in memory or read from a file, such as `new Blob([bytes]).stream()` or `Bun.file().stream()`, and sends any other `ReadableStream`, including a `fetch()` response body, with `Transfer-Encoding: chunked` (oven-sh/bun#10507). `LocalObjectStore` streams files through a JavaScript `ReadableStream`, so its objects go out chunked and without the length, except sometimes for very small objects.
