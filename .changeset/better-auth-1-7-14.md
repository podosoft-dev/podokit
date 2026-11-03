---
"@podosoft/podokit": patch
"@podosoft/podokit-api-client": patch
---

New authentication modules and the API client now require Better Auth 1.7.14 with matching API key, passkey, and OAuth provider plugins. The release accepts imported two-factor TOTP secrets stored as `base32:<secret>`, and type declarations no longer list type-only exports as values. No configuration change is needed.
