---
"@podosoft/podokit": patch
---

Make the `audit-log` module record a sign-in through any endpoint, including those of Better Auth plugins an application adds to its own `auth.ts`, such as `@better-auth/electron`'s `/electron/token`. The audit plugin recorded `auth.login` only for the endpoints in its `SIGN_IN_METHODS` list, so a desktop app's sign-in left no entry. It now records a request that ends with a new session it did not come with, naming the endpoint's path in `metadata.method` when the endpoint is not in `SIGN_IN_METHODS`, except the endpoints in the new `NOT_SIGN_INS` list: sign-up, impersonation, switching between a browser's sessions, and requests that replace the signed-in user's own session. Session reads and updates that refresh the request's own session, bearer and API key requests included, and endpoints that another endpoint dispatches are not recorded as sign-ins.
