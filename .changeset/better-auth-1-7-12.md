---
"@podosoft/podokit": patch
"@podosoft/podokit-api-client": patch
---

New authentication modules and the API client now require Better Auth 1.7.12 with matching API key, passkey, and OAuth provider plugins. The release verifies JWTs with the stored key's algorithm, applies the full callback checks to OAuth Proxy callbacks, and rejects ID token sign-in for providers without a client ID. Generated applications only enable social providers that have a client ID, so no configuration change is needed.
