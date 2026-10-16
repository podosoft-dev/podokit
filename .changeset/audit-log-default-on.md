---
"@podosoft/podokit": patch
"@podosoft/podokit-auth": minor
---

Record the audit log in apps that never set its toggle. With the audit-log module installed, an unset or empty `AUDIT_LOG_ENABLED` now means on, only `false` turns it off, and the admin Settings toggle still overrides both; before, a deployment without the variable and without a saved setting recorded nothing. The API logs one warning at startup while the audit log is off. `createConfigStore()` and `envAuthConfig()` in `@podosoft/podokit-auth` take a `defaults` object for values that neither a row nor the environment sets, and the auth module keeps them in `AUTH_CONFIG_DEFAULTS` (`apps/api/src/auth/auth-config-store.ts`), where the audit-log module adds `auditLog: true`.
