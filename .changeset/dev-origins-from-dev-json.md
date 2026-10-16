---
"@podosoft/podokit": patch
---

Set `CORS_ORIGIN` and `BETTER_AUTH_URL` for the development containers from `.podokit/dev.json` in `podo dev`, and render the generated files that name the development host from it, so a renamed host no longer breaks sign-in with an invalid origin.
