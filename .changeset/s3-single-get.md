---
"@podosoft/podokit": patch
"@podosoft/podokit-runtime": patch
---

Read S3 objects with one request and keep the `Content-Length` of small ones. In the `object-storage-s3` module, `StorageService.open()`, which backs `OBJECT_STORAGE.get()`, sends one presigned GET instead of a HEAD followed by a GET with `If-Match`, takes the metadata from that response, and reads objects up to 2 MiB (`IN_MEMORY_READ_BYTES`) into memory, because Bun sends any other streamed body with chunked encoding and drops the length that `objectResponse` sets. Larger objects stream from the GET, which stays open until the body is read or cancelled. A missing bucket now throws instead of resolving `null`. The runtime's `ObjectData.body` documentation no longer promises a body that opens on its first read.
