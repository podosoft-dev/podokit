---
"@podosoft/podokit": patch
---

Generated web apps require `vite ^8.3.5` and `vitest ^4.1.12`. The old floors (`^8.2.1`, `^4.1.10`) allowed a lockfile to keep a Vite 8.2.0–8.2.3 dev server or a `@vitest/mocker` older than 4.1.12, both of which have published security advisories for the development server. Fresh installs already resolved the fixed releases.
