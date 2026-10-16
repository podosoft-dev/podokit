---
"@podosoft/podokit": patch
---

`.podokit/files.lock` never records local environment files such as `.env`, `.env.docker` or `apps/api/.env`, which Git ignores and which hold secrets; the committed `*.example` files are still recorded. `podo update` had written the hash of `.env.docker` into the lock, and after `podo add`, `podo remove` or `podo provider set` recorded `.env` as a managed file, the next `podo update` deleted it as removed upstream. Entries an earlier version wrote are ignored and dropped on the next lock write.
