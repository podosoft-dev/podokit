---
"@podosoft/podokit": minor
"@podosoft/podokit-module-blog": minor
"@podosoft/podokit-module-analytics": minor
---

Ship the shadcn-svelte `textarea` in the generated UI set at `apps/web/src/lib/components/ui/textarea`, vendored from the official registry for the template's `nova` style like the other primitives. `components.json` now maps the `utils`, `hooks`, and `lib` aliases to the `#lib` import map, so `bunx --bun shadcn-svelte@latest add <component>` works in a generated app; it stopped with an invalid `hooks` alias and wrote `#lib/utils.js.js` imports before. The blog and analytics modules no longer ship their own textarea copy, which `podo remove` could delete from under other pages; they declare the shared component as a required project file, so `podo add` asks an older project to run `podo update --apply` first.
