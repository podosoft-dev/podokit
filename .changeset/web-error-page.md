---
"@podosoft/podokit": patch
---

Give generated web apps their own fallback error page. When the root layout or a server hook fails, such as with 503 while the API is down, SvelteKit served its built-in page because the template had no `apps/web/src/error.html`. The template now ships a self-contained, application-owned `error.html` with inline styles for light and dark color schemes, a viewport, and only the `%sveltekit.status%` and `%sveltekit.error.message%` placeholders, so it needs no translations. `podo update` creates it once in existing apps and never overwrites it, including an `error.html` an app already has.
