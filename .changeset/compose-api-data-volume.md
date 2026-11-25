---
"@podosoft/podokit": patch
---

Keep the API's own files across Docker Compose releases. With the local object store or a SQLite database, the files lived in the API container's filesystem, and every `podo deploy apply` replaced the container, so stored uploads and attachments (or the database) were lost. The Compose profile now has `workloads.api.dataVolume`: an external named volume mounted at `/app/apps/api/data` on the API, the worker, and the migration, which `podo deploy init` sets to `<project>-api-data` for those providers and apply creates. `podo deploy doctor` fails when such an app's profile has no data volume or sets `LOCAL_STORAGE_PATH` outside that directory; add `"dataVolume": "<project>-api-data"` under `workloads.api` in an existing profile. The managed `apps/api/Dockerfile` now creates that directory owned by `bun`, so the API can write to it (and to a new volume mounted there).
