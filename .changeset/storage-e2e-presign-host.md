---
"@podosoft/podokit": patch
---

Download the presigned object in the generated storage API test only when the test runner has `S3_ENDPOINT`, so the test passes against a containerized `podo dev` stack whose URLs are signed for an in-network host.
