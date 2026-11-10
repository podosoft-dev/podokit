---
"@podosoft/podokit": patch
"@podosoft/podokit-api-client": patch
---

Require Better Auth 1.7.17 with matching API key, passkey, and OAuth provider plugins. New API workspaces require Elysia 1.4.31, and file-upload download URLs decode their key once before ownership checks, preserving URL-encoded upload keys while rejecting malformed and double-encoded values. Resumable upload routes convert numeric part numbers in the handler so Bun's native router does not need to mutate its path parameters.
