---
"@podosoft/podokit": patch
---

Generated API workspaces depend on `zod ^4.6.7` instead of `^3.23.8`. Zod 3 and Zod 4 before 4.6.6 can exhaust memory while validating oversized constrained collections (GHSA-mrhx-c7xc-m3w5), and there is no Zod 3 fix. The managed environment validation works unchanged; applications that import `zod` in their own code, including `env.extensions.ts`, should review it against the Zod 4 changelog after `podo update`.
