---
"@podosoft/podokit": patch
"@podosoft/podokit-mcp": patch
---

Pin generated applications to Bun 1.4.4 for its security fixes. Bun 1.4.3 and earlier build a Brotli decoder without the fix for CVE-2026-111497, an out-of-bounds write that the Node.js October 2026 security release rates as possible remote code execution. A Bun server reaches that decoder from `fetch()` on any `Content-Encoding: br` response, from `node:zlib`, and from `DecompressionStream`. Bun 1.4.4 updates Brotli to 1.2.1 and also ships fixes for TLS, WebSocket, the database clients, and the package manager. `packageManager`, `engines`, every `oven/bun` image, and the generated CI now use 1.4.4, and `podo update` records the new version in the manifest. The repository workflows move to Node 22.23.4, which carries the same Node.js release.
