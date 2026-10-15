---
"@podosoft/podokit-runtime": minor
"@podosoft/podokit": minor
---

Stream object writes and add multipart uploads. `ObjectBody` now includes `Blob` and `ReadableStream`, and `ObjectStore` gains `createMultipartUpload`, `uploadPart`, `completeMultipartUpload`, and `abortMultipartUpload`, with `MIN_MULTIPART_PART_BYTES`, `MAX_MULTIPART_PARTS`, `MultipartUploadError`, and the `objectBodyChunks`, `assertPartNumber`, and `normalizeCompletedParts` helpers. `LocalObjectStore` writes streamed bodies to a temporary file, keeps multipart parts under `.podokit/multipart/`, and removes idle uploads after `multipartMaxAgeMs`. The S3 module streams large bodies as multipart uploads with bounded memory, signs multipart requests with AWS Signature Version 4, and aborts an upload whose body fails; the local module adds `LOCAL_STORAGE_MULTIPART_MAX_AGE`. Custom `ObjectStore` implementations must add the four multipart methods.
