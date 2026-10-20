---
"@podosoft/podokit": patch
"@podosoft/podokit-mcp": patch
---

Pin generated applications to Bun 1.4.3 so the containerized Vite dev server no longer stalls when a request arrives while it starts. Before it listens, Vite binds and closes a bare probe server on each wildcard address; on Bun 1.4.0 a request that reached the web container during a probe left a paused socket whose end was never seen, so `server.close()` never called back, the log stopped after `(ssr) connected.`, and the dev gateway answered 502 until the container restarted. Bun 1.4.1 fixed it. `packageManager`, `engines`, every `oven/bun` image, and the generated CI now use 1.4.3, and `podo update` records the new version in the manifest.
