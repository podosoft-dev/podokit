---
"@podosoft/podokit": minor
---

Send the API the public origin a request came in on. The `/api` proxy and the server-side API client set `x-forwarded-host` and `x-forwarded-proto` from the request URL SvelteKit resolved, only when `CORS_ORIGIN` lists that origin, so an API route can build links for the origin a visitor used without trusting a header a caller wrote.
