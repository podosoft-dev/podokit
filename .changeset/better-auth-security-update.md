---
"@podosoft/podokit-api-client": patch
"@podosoft/podokit": patch
---

Require Better Auth 1.7.7 and matching API key, passkey, and OAuth provider integrations in the API client and generated authentication module. Document coordinated upgrades and reissuing pending Magic Links after the security update.

Clean up obsolete account issuer constraints before applying the current PostgreSQL or SQLite authentication schema. Preserve account data, reject identity collisions, and support repeated migrations.
