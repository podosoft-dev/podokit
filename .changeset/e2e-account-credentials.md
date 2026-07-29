---
"@podosoft/podokit": patch
---

Stop the e2e suite from depending on a seeded account's password, and fix the
change-password spec that could never pass.

`tests/helpers/accounts.ts` hardcoded the seed password, so the suite could only
sign in on a stack it had created itself. Against an install bootstrapped with
`admin:bootstrap`, `admin@example.com` is a real account with a password somebody
uses — and the only way to make the run green was to reset that account to match
the constant, which takes their login with it. The passwords now read
`E2E_ADMIN_PASSWORD` / `E2E_USER_PASSWORD` and fall back to the seed value, so an
existing account is told to the suite instead of altered. Without the override the
run fails with `INVALID_EMAIL_OR_PASSWORD` — a refusal rather than a silent
overwrite. The two-factor and account specs that signed in as the shared accounts
now use the same constants.

The spec asserting that a mistyped password confirmation is refused clicked a
button named `Update`; the button is `Update password`, so the test timed out
before reaching its assertion and had never passed. It now clicks the real button
and first asserts the error is absent, so a form that showed it unconditionally
would still fail.
