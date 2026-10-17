---
"@podosoft/podokit": patch
---

Make the generated API contract check (`bun run contract`) expect a provider module's routes only while `PROVIDERS` selects its provider, including a `<CAPABILITY>_PROVIDER` override, so an app with both object-storage, cache, or jobs providers installed no longer fails on the unselected module's routes. The check now also covers the `jobs-local` routes.
