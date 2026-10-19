---
"@podosoft/podokit": patch
---

Give Docker Compose application containers the stop timeout Kubernetes gives their pods. The rendered services set no `stop_grace_period`, so Docker killed an API or web server 10 seconds after `SIGTERM`, while the web server drains open requests for `SHUTDOWN_TIMEOUT` (30 seconds unless set) and Kubernetes waits 40 seconds, 35 of them after `SIGTERM`. The API and web services now render `stop_grace_period` as `SHUTDOWN_TIMEOUT` from `runtimeConfig` plus 5 seconds, 35 by default, and the worker 30 seconds, the default it keeps on Kubernetes. Dependencies and the gateway keep Docker's default, so the first apply after upgrading does not recreate them. That apply recreates the API, web, and worker, and a rollback to a revision applied before this change is refused because it no longer renders byte for byte.
