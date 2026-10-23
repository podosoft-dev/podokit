---
"@podosoft/podokit": patch
---

Compose apply and rollback now recreate a changed gateway on its own with `compose up --no-deps` once the application rollout is done. The final `compose up` stopped the old gateway and started the new one only after walking its dependencies, including a fresh object storage init run, which kept the published port closed for about 13 seconds on a production host instead of well under a second.
