---
"@podosoft/podokit": minor
---

Add application-owned e2e seams: `tests/helpers/app-paths.ts` (first screen and its locator, indexable public pages, the pages with the site footer and the account menu) and, with `admin-dashboard`, `tests/helpers/app-accounts.ts` for the seeded accounts, with `E2E_ADMIN_EMAIL` and `E2E_USER_EMAIL` overrides. Managed specs read them instead of assuming the generated landing page, login footer, and `admin@example.com`/`user@example.com`, and `SiteFooter` carries `data-testid="site-footer"`.
