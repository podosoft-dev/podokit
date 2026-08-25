---
"@podosoft/podokit": patch
---

Keep generated authentication flows aligned with Better Auth 1.7 by narrowing
two-factor setup responses and running schema migrations through the version
installed by the application. Pin anonymous browser tests to English so a
custom site locale does not invalidate the generated accessibility locators.
Follow OIDC authorization redirects explicitly in browser tests and keep
module-agnostic smoke coverage compatible with application-owned home pages.
