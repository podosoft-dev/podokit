---
"@podosoft/podokit": patch
---

Let the generated cross-site form check run where `__PODOKIT_CSRF_TRUSTED_ORIGINS__` is not defined. The managed `apps/web/vite.config.ts` defines it from `csrf.trustedOrigins` in `vite.extensions.ts`, but a config the app owns does not, such as its own `apps/web/vitest.config.ts`, which Vitest then reads instead. There `apps/web/src/lib/server/csrf.ts` threw `ReferenceError: __PODOKIT_CSRF_TRUSTED_ORIGINS__ is not defined` for every POST, PUT, PATCH, or DELETE without explicit trusted origins, so the managed `csrf.test.ts` failed after `podo update`. The module now reads the name through `typeof` and trusts no other origin when it is missing, so only the site's own forms pass, as before. With the managed config the build still inlines the configured origins.
