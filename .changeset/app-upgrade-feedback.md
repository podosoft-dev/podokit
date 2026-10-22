---
"@podosoft/podokit": patch
---

Fix problems found while upgrading generated apps:

- The end-to-end tests that change a server toggle (account deletion, audit logging, sign-up approval) now restore what was stored before instead of saving a fixed value, so running them no longer leaves account deletion off on a server that enables it through `AUTH_ALLOW_DELETE`. `PUT /account/auth-config` accepts `null` for a server toggle to drop its stored value, and `GET /account/auth-config` lists the stored toggles in `serverOverrides`.
- `podo update` reports deployment profiles whose `runtimeConfig` still sets a client address key that PodoKit derives from `exposure.edgeProxies`. The deploy error for `RATE_LIMIT_TRUSTED_PROXY_HOPS` and `RATE_LIMIT_PROXY_HEADER` now points at `exposure.edgeProxies` instead of another refused key.
- The auth runtime spec that simulates an unresponsive database restores the real one afterwards, so later specs in the same run no longer hang.
- The dev-server test for re-created components sends the file events itself instead of waiting for the platform's file watcher, which could merge them on macOS.
- The templates guide explains how to give `Textarea` a fixed height, since it grows with its content and ignores `rows`.
