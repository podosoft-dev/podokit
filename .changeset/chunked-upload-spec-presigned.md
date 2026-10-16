---
"@podosoft/podokit": patch
---

Let the file-upload module's `tests/api/chunked-uploads.api.spec.ts` pass on a containerized dev stack. It downloaded the completed object through the S3 presigned URL, which the API signs for its own S3 endpoint; on a container stack that is an in-network host such as `minio`, so a host-side runner failed with `getaddrinfo EAI_AGAIN minio`. Like the S3 storage spec, it now downloads from S3 and checks the SHA-256 only when the runner has `S3_ENDPOINT`, and always downloads the signed API path that local storage returns. The completed size it checks comes from the stored object either way.
