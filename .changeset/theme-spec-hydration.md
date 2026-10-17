---
"@podosoft/podokit": patch
---

Make the generated theme spec wait for hydration after it reloads the page and find the theme toggle by its new `data-testid="theme-toggle"` on the `accountMenu` page from `tests/helpers/app-paths.ts`, so it no longer fails against a development server or with an application's own header.
