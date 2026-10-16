---
"@podosoft/podokit": patch
---

Show every session on the account page's Sessions tab. Better Auth's `GET /api/auth/list-sessions` returns at most 100 sessions, so a user with more could see no "Current" row. The admin dashboard adds `GET /account/sessions` (the caller's own sessions, keyset-paged, the current one on every page, no tokens, Better Auth's freshness rule kept) and `DELETE /account/sessions/{id}` (revokes through Better Auth's audited `/revoke-session`), and the account page uses them.
