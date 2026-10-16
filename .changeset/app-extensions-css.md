---
"@podosoft/podokit": minor
---

Add an application-owned stylesheet, `apps/web/src/app.extensions.css`, that the managed `app.css` imports last. Theme variable overrides, `@theme` entries, fonts, base styles, and `@source` lines for packages whose built components use Tailwind classes go there instead of into `app.css`. `podo update` creates the file once and never overwrites it.
