---
"@podosoft/podokit": patch
"@podosoft/podokit-module-blog": patch
---

Bind blog tags as native JSON arrays with Bun SQL, isolate browser authors from
rate-limit state across repeated test runs, and let SvelteKit page metadata own
the document title without a conflicting static template title. Use one Elysia
route parameter name for blog post identifiers and slugs so the router can
compile every blog endpoint together.
