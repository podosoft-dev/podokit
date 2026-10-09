---
"@podosoft/podokit": patch
---

Run the generated API type check with `bunx --bun tsc`, so an older Node on `PATH`, such as the one on some self-hosted CI runners, no longer runs TypeScript and fails `bun run lint`.
