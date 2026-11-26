---
"@podosoft/podokit": patch
---

Make the development migration retry test check the delays it asks for instead of timing real timers. On a loaded CI runner the first 10 ms wait sometimes ran longer than the second and failed the comparison. `applyDevelopmentMigrations` takes an optional `wait` for this; the default is the same timer as before.
