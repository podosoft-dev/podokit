---
"@podosoft/podokit": patch
---

Let an administrator add someone who signs in with Google (or another configured social provider) while public sign-up is closed. Accounts created on `/admin/users` always had a password and an unverified email, and Better Auth links a provider sign-in to an existing account only when its email is verified, so that person's Google sign-in failed with `account_not_linked` and there was no way to fix it from the admin pages when email verification was off. *Add user* now has a *Sign in with <provider> only (no password)* option, shown when a social provider is configured, which creates the account without a password and with its email marked verified; and the manage dialog shows the verification state and *Mark verified* even when email verification is off. The login page and the users page share the provider names in `#lib/auth-providers.ts`.
