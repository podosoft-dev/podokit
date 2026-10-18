---
"@podosoft/podokit": patch
---

Keep Kubernetes API and web pods serving while a rolling update removes them. A terminating pod still receives new connections until every node and the ingress controller drop it from the Service's endpoints, but the servers stop accepting connections on `SIGTERM`, so a rollout could answer a request with a 502. The rendered API and web containers now have a `preStop` hook that runs `sleep 5` before `SIGTERM`, and their pods a `terminationGracePeriodSeconds` that covers the hook, the web server's `SHUTDOWN_TIMEOUT` drain (30 seconds unless `runtimeConfig` sets it), and 5 seconds to exit: 40 by default instead of Kubernetes' 30. The rendered manifests change, so the next `podo deploy plan` produces a new confirmation hash.
