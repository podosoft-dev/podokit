---
"@podosoft/podokit": minor
---

Add the application-owned `apps/api/scripts/build.extensions.mjs` with `appBuildTargets`, entry points the API build bundles next to PodoKit's, so apps stop editing the managed `scripts/build.mjs`. A missing entry point fails the build.
