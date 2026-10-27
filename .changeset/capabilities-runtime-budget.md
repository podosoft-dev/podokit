---
"@podosoft/podokit": patch
---

The rate-limit module counts `GET /account/capabilities` in the runtime budget with session and site-settings reads. The web server reads capabilities on every server-rendered page, so on the general budget an administrator browsing quickly, or a two-worker Playwright run against `podo dev`, reached `RATE_LIMIT_MAX` and received 429 on ordinary admin requests.
