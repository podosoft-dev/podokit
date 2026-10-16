---
"@podosoft/podokit": minor
---

Make `README.md`, `tests/README.md`, `.gitignore`, `.env.example`, `.env.docker.example`, and `infra/k3s/**` owned seeds: applications rewrite them, so `podo update` now reports their template changes for review instead of merging them, and a deleted `infra/k3s/` stays deleted.
