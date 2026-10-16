---
"@podosoft/podokit": patch
---

Sort the root `package.json` dependency section that external modules are listed in, as Bun and npm write it, so an app with two or more external modules no longer shows that file as edited.
