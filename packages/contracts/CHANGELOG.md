# @podosoft/podokit-contracts

## 0.6.0

### Minor Changes

- [#241](https://github.com/podosoft-dev/podokit/pull/241) [`9b5322b`](https://github.com/podosoft-dev/podokit/commit/9b5322bc5e4f2cea726dd62929cce0470eb3b14d) Thanks [@korone00](https://github.com/korone00)! - Let `AppException` carry `details`. Its optional fourth argument is returned as `error.details` in the API's error envelope, so apps stop subclassing it and editing the managed `app.ts`. The API's error rendering moved into the exported `renderError()`.

- [#241](https://github.com/podosoft-dev/podokit/pull/241) [`9b5322b`](https://github.com/podosoft-dev/podokit/commit/9b5322bc5e4f2cea726dd62929cce0470eb3b14d) Thanks [@korone00](https://github.com/korone00)! - Add the auth module's application-owned `apps/api/src/settings/app-flags.ts` with `APP_FLAG_DEFAULTS`. Application flags are stored with the feature flags, changed with `PUT /account/settings`, read with `SettingsService.getBool()`, and returned as `appFlags` by `GET /account/capabilities` (`Capabilities.appFlags`), so apps stop editing the managed `flag-defaults.ts` and adding their own capability routes. A name PodoKit already uses fails at startup.

## 0.5.0

### Minor Changes

- [#215](https://github.com/podosoft-dev/podokit/pull/215) [`526c506`](https://github.com/podosoft-dev/podokit/commit/526c50657fc0f64f7b84ccf553f94b141904e2c6) Thanks [@korone00](https://github.com/korone00)! - Cut the fixed cost of every request in generated apps. Session reads no longer sign an unused JWT header, unsigned bearer values are rejected without a session lookup, and rate limiting keys signed sessions by a verified cookie hash instead of a database lookup. Server rendering loads site settings and the session together, memoizes capabilities per request, and stops resending the message catalog on client navigation. `Capabilities` gains `require2fa`. Site settings come from one cached query, the merged OpenAPI document is reused, the rate-limit script runs by SHA, and OAuth consent sends the signed authorization query.

## 0.4.0

### Minor Changes

- [#119](https://github.com/podosoft-dev/podokit/pull/119) [`cd7e13b`](https://github.com/podosoft-dev/podokit/commit/cd7e13b7a93b4fea7588ffed87c82ac5be8073ee) Thanks [@korone00](https://github.com/korone00)! - Add self-service profile-image upload, replacement, removal, shared validation limits, multipart API client support, and a reusable signed-in account menu for generated landing pages.

## 0.3.0

### Minor Changes

- [#114](https://github.com/podosoft-dev/podokit/pull/114) [`b05637f`](https://github.com/podosoft-dev/podokit/commit/b05637f68518080cf88bca87a79a8b9aae1aee25) Thanks [@korone00](https://github.com/korone00)! - Add a live automatic-logout policy with validated idle durations, sliding Better Auth session expiration, existing-session updates, cross-tab browser inactivity handling, and localized admin controls.

## 0.2.1

### Patch Changes

- [#99](https://github.com/podosoft-dev/podokit/pull/99) [`b048480`](https://github.com/podosoft-dev/podokit/commit/b048480b8a35f1e26ad8c1c354822e1ea3477d22) Thanks [@korone00](https://github.com/korone00)! - Enforce closed public registration for every new-user flow, including social OAuth callbacks, return a stable policy error code, preserve safe authentication return paths, persist exact OAuth callbacks for stable HTTPS development origins, and allow callback-only repair without replacing stored provider credentials.

## 0.2.0

### Minor Changes

- [#90](https://github.com/podosoft-dev/podokit/pull/90) [`b6267eb`](https://github.com/podosoft-dev/podokit/commit/b6267ebc568c01fdf35452c17a00a8d068cdcb36) Thanks [@korone00](https://github.com/korone00)! - Add provider-independent sign-up approval, admin approval controls, social-login buttons, and redacted OAuth/SMTP configuration automation.
