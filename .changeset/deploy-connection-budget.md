---
"@podosoft/podokit": minor
---

Count the PostgreSQL connections a deployment can open in `podo deploy doctor` and `podo deploy plan`: every API and worker process with `DB_POOL_MAX` + 1 and, with `auth`, `DB_AUTH_POOL_MAX`, one surge pod per workload during a Kubernetes rollout, and the migration. The doctor fails when the processes alone exceed `max_connections` minus the 3 reserved connections, and both warn when a deployment can. New profile fields `dependencies.postgres.maxConnections` (default 100, rendered as `-c max_connections` for a PostgreSQL server PodoKit runs) and `dependencies.postgres.appPools` (application pools by the `runtimeConfig` key that caps them) feed the count. The Kubernetes `plan` now prints its warnings.
