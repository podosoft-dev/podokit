---
"@podosoft/podokit": minor
---

Proxy the exact `webSocketPaths` of `.podokit/dev.json` to the API from the Vite dev server, so a WebSocket endpoint works under `bun run dev` the way it does behind the `podo dev` gateway and a deployment's edge, without a proxy entry of the application's own.
