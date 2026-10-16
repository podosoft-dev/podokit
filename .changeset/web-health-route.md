---
"@podosoft/podokit": patch
---

Generated web apps answer `GET /healthz` without calling the API, and the rendered Kubernetes probes (now with `timeoutSeconds: 2`), the Compose healthcheck, and the web image's `HEALTHCHECK` request it instead of `/`, so an API outage no longer takes the web pods out of service or restarts them. `podo update` adds the route and updates the web `Dockerfile`; deploy a release built from the updated app.
