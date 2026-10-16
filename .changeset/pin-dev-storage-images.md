---
"@podosoft/podokit": patch
---

Pin the development Silo and `mc` images by digest and stop the bucket setup on the first error (`sh -e`, `mc mb --ignore-existing`) in `compose.dev.yaml` and the `object-storage-s3` compose overlay, so a bucket that cannot be created fails at startup.
