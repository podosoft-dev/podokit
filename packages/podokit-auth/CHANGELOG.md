# @podosoft/podokit-auth

## 0.6.0

### Minor Changes

- [#241](https://github.com/podosoft-dev/podokit/pull/241) [`9b5322b`](https://github.com/podosoft-dev/podokit/commit/9b5322bc5e4f2cea726dd62929cce0470eb3b14d) Thanks [@korone00](https://github.com/korone00)! - Record the audit log in apps that never set its toggle. With the audit-log module installed, an unset or empty `AUDIT_LOG_ENABLED` now means on, only `false` turns it off, and the admin Settings toggle still overrides both; before, a deployment without the variable and without a saved setting recorded nothing. The API logs one warning at startup while the audit log is off. `createConfigStore()` and `envAuthConfig()` in `@podosoft/podokit-auth` take a `defaults` object for values that neither a row nor the environment sets, and the auth module keeps them in `AUTH_CONFIG_DEFAULTS` (`apps/api/src/auth/auth-config-store.ts`), where the audit-log module adds `auditLog: true`.

- [#241](https://github.com/podosoft-dev/podokit/pull/241) [`9b5322b`](https://github.com/podosoft-dev/podokit/commit/9b5322bc5e4f2cea726dd62929cce0470eb3b14d) Thanks [@korone00](https://github.com/korone00)! - Name the app in sign-in prompts. Better Auth's `appName`, the TOTP issuer shown by authenticator apps, and the passkey relying-party name shown by browsers now come from one value: `AUTH_APP_NAME` when set, otherwise the admin site name (`site.name`), otherwise the project name. Before, users saw "Better Auth" and "PodoKit". `AuthConfig` gains `appName`, and `createConfigStore()` takes `appNameSetting` (an app_setting key whose change changes the config version) and `defaults.appName`.

## 0.5.0

### Minor Changes

- [#216](https://github.com/podosoft-dev/podokit/pull/216) [`99a1305`](https://github.com/podosoft-dev/podokit/commit/99a1305eb040745ba3bbfaab9427fb8320533da4) Thanks [@korone00](https://github.com/korone00)! - Make runtime settings and the audit log scale. The settings store probes `auth_config` and `app_setting` versions with one cheap query per tick and reloads only on change, detects deleted rows, memoizes derived settings and the secret key, and refreshes `SettingsService` across replicas (with immediate invalidation over the events bus when one is installed). Auth settings save on SQLite. The audit log honours its toggle on every write, can defer non-security writes, pages with a cursor and server-side filters, indexes those filters, stores metadata as JSON, and can prune entries after `AUDIT_LOG_RETENTION_DAYS`.

## 0.4.0

### Minor Changes

- [#187](https://github.com/podosoft-dev/podokit/pull/187) [`77abca6`](https://github.com/podosoft-dev/podokit/commit/77abca69c99ff284a600e139e9664590483e3e75) Thanks [@korone00](https://github.com/korone00)! - Add provider-neutral database, cache, object storage, event, and job contracts with selectable distributed and local implementations.
  
  Add dry-run-first provider inspection and switching for existing generated projects, SQLite project generation, provider-aware deployment profiles, and local single-process modules for desktop applications.
  
  Generalize the auth configuration store around a database-neutral repository contract.

## 0.3.1

### Patch Changes

- [#163](https://github.com/podosoft-dev/podokit/pull/163) [`c225b20`](https://github.com/podosoft-dev/podokit/commit/c225b206508e486f37dbbc12fb67195bd978c02e) Thanks [@korone00](https://github.com/korone00)! - Refresh the Better Auth client dependency floor and the PostgreSQL verification toolchain while preserving the packages' existing public compatibility ranges.

- [#166](https://github.com/podosoft-dev/podokit/pull/166) [`9855ba8`](https://github.com/podosoft-dev/podokit/commit/9855ba8f5703b459231bf10cb3b1a96f842f4987) Thanks [@dependabot](https://github.com/apps/dependabot)! - Refresh PostgreSQL development type definitions while updating the repository test and release tooling.

## 0.3.0

### Minor Changes

- [#114](https://github.com/podosoft-dev/podokit/pull/114) [`b05637f`](https://github.com/podosoft-dev/podokit/commit/b05637f68518080cf88bca87a79a8b9aae1aee25) Thanks [@korone00](https://github.com/korone00)! - Add a live automatic-logout policy with validated idle durations, sliding Better Auth session expiration, existing-session updates, cross-tab browser inactivity handling, and localized admin controls.

## 0.2.0

### Minor Changes

- [#90](https://github.com/podosoft-dev/podokit/pull/90) [`b6267eb`](https://github.com/podosoft-dev/podokit/commit/b6267ebc568c01fdf35452c17a00a8d068cdcb36) Thanks [@korone00](https://github.com/korone00)! - Add provider-independent sign-up approval, admin approval controls, social-login buttons, and redacted OAuth/SMTP configuration automation.
