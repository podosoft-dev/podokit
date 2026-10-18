---
"@podosoft/podokit": patch
---

Count a Kubernetes rollout as twice the API and worker replicas in the PostgreSQL connection budget of `podo deploy doctor` and `podo deploy plan`, instead of one surge pod more per workload. Kubernetes starts the next replacement as soon as the previous one is ready without counting terminating pods against `maxSurge`, and a replaced pod keeps its pools until it exits, so every old pod can still hold connections while all the new ones run. With the defaults and `auth`, two API replicas now count 124 during a rollout instead of 93, above the 97 that the default `max_connections` leaves, so the doctor and the plan warn until the pools are lowered or the limit raised.
