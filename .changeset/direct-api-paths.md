---
"@podosoft/podokit": minor
---

Route listed API paths past the web proxy. `exposure.apiPaths` in deployment profiles and `apiPaths` in `.podokit/dev.json` send static prefixes under `/api/` straight to the API with `/api` removed, through a second Traefik Ingress with a `stripPrefix` Middleware on Kubernetes, the Caddy gateway on Docker Compose, and the shared Traefik gateway in `podo dev`, so large uploads are no longer capped by the web server's `BODY_SIZE_LIMIT`. `podo dev` also renders one Traefik matcher per WebSocket path, which Traefik v3 requires.
