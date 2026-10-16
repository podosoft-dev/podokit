---
"@podosoft/podokit": patch
---

Make "sign out other sessions" revoke every other session. Better Auth's `POST /api/auth/revoke-other-sessions` lists sessions through the adapter's default limit of 100 and revoked only those; the auth module's new `revokeEveryOtherSession` plugin revokes the rest in batches through Better Auth's internal adapter, including secondary-storage entries.
