---
"@podosoft/podokit": minor
"@podosoft/podokit-auth": minor
---

Make runtime settings and the audit log scale. The settings store probes `auth_config` and `app_setting` versions with one cheap query per tick and reloads only on change, detects deleted rows, memoizes derived settings and the secret key, and refreshes `SettingsService` across replicas (with immediate invalidation over the events bus when one is installed). Auth settings save on SQLite. The audit log honours its toggle on every write, can defer non-security writes, pages with a cursor and server-side filters, indexes those filters, stores metadata as JSON, and can prune entries after `AUDIT_LOG_RETENTION_DAYS`.
