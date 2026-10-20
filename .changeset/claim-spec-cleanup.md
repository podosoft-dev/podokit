---
"@podosoft/podokit": patch
---

Keep the generated `a sign-up cannot claim an ADMIN_EMAILS address` test from leaving a real account behind. When `E2E_UNCLAIMED_ADMIN_EMAIL` named an address the running API did not list in `ADMIN_EMAILS`, the sign-up succeeded and the account stayed, and the user search tests for `admin@example.com` then failed on two matching rows. The test now refuses to run for an address that already has an account, removes any account its sign-up created, and fails with a message naming the missing `ADMIN_EMAILS` entry. The user table tests match email cells exactly.
