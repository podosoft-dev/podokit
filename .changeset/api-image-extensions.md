---
"@podosoft/podokit": minor
---

Let an application install system packages and command-line tools in its API images. The new application-owned `apps/api/image.extensions.sh` runs as root in the runtime stage of the managed `apps/api/Dockerfile`, before the image switches to the `bun` user, and in `Dockerfile.dev`, so development and production have the same tools; `TARGETARCH` gives the architecture. `podo update` creates the file once in an existing app. `podo dev watch` now rebuilds the development containers when `Dockerfile.dev` or this script changes.
