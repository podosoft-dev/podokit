---
"@podosoft/podokit": patch
---

Run the generated theme spec in apps without an account menu page instead of skipping it: it opens the new `themeToggle` entry of `tests/helpers/app-paths.ts`, which defaults to `accountMenu` and, when that is `null`, to the admin console, whose header renders the theme toggle.
