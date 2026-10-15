---
"@podosoft/podokit": patch
---

`podo dev up` passes `--build` to `docker compose up` unless `--build` or `--no-build` is given. Compose Watch syncs edits into running containers only, so when `up` recreated a container (after a memory limit or `.env.docker` change, even while `podo dev watch` was running) the new container started from the last built image and lost every synced edit.
