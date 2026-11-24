---
"@podosoft/podokit": patch
---

Keep local object storage files across development container rebuilds. With `object-storage-local`, `podo dev` now mounts the named volume `podokit-api-data` at the API's `apps/api/data`, where the default `LOCAL_STORAGE_PATH` keeps files, so they survive when Compose recreates the container.
