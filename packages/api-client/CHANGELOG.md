# @podosoft/podokit-api-client

## 0.8.1

### Patch Changes

- [#169](https://github.com/podosoft-dev/podokit/pull/169) [`eb0c707`](https://github.com/podosoft-dev/podokit/commit/eb0c707d484c6458e8c8c99866e9973875649654) Thanks [@dependabot](https://github.com/apps/dependabot)! - Align generated authentication dependencies with Better Auth 1.7.1 and use local account row IDs when unlinking providers.

- [#163](https://github.com/podosoft-dev/podokit/pull/163) [`c225b20`](https://github.com/podosoft-dev/podokit/commit/c225b206508e486f37dbbc12fb67195bd978c02e) Thanks [@korone00](https://github.com/korone00)! - Refresh the Better Auth client dependency floor and the PostgreSQL verification toolchain while preserving the packages' existing public compatibility ranges.

- [#167](https://github.com/podosoft-dev/podokit/pull/167) [`196278a`](https://github.com/podosoft-dev/podokit/commit/196278aa7aa29d17d549d653e95e27b8e9df7958) Thanks [@dependabot](https://github.com/apps/dependabot)! - Raise the API key client dependency floor to Better Auth 1.7.1.

- [#168](https://github.com/podosoft-dev/podokit/pull/168) [`8f2a9d4`](https://github.com/podosoft-dev/podokit/commit/8f2a9d476de9bc24e8016b106dfe7973c86faf37) Thanks [@dependabot](https://github.com/apps/dependabot)! - Raise the passkey client dependency floor to Better Auth 1.7.1.

## 0.8.0

### Minor Changes

- [#119](https://github.com/podosoft-dev/podokit/pull/119) [`cd7e13b`](https://github.com/podosoft-dev/podokit/commit/cd7e13b7a93b4fea7588ffed87c82ac5be8073ee) Thanks [@korone00](https://github.com/korone00)! - Add self-service profile-image upload, replacement, removal, shared validation limits, multipart API client support, and a reusable signed-in account menu for generated landing pages.

### Patch Changes

- Updated dependencies [[`cd7e13b`](https://github.com/podosoft-dev/podokit/commit/cd7e13b7a93b4fea7588ffed87c82ac5be8073ee)]:
  - @podosoft/podokit-contracts@0.4.0

## 0.7.0

### Minor Changes

- [#114](https://github.com/podosoft-dev/podokit/pull/114) [`b05637f`](https://github.com/podosoft-dev/podokit/commit/b05637f68518080cf88bca87a79a8b9aae1aee25) Thanks [@korone00](https://github.com/korone00)! - Add a live automatic-logout policy with validated idle durations, sliding Better Auth session expiration, existing-session updates, cross-tab browser inactivity handling, and localized admin controls.

### Patch Changes

- Updated dependencies [[`b05637f`](https://github.com/podosoft-dev/podokit/commit/b05637f68518080cf88bca87a79a8b9aae1aee25)]:
  - @podosoft/podokit-contracts@0.3.0

## 0.6.1

### Patch Changes

- [#99](https://github.com/podosoft-dev/podokit/pull/99) [`b048480`](https://github.com/podosoft-dev/podokit/commit/b048480b8a35f1e26ad8c1c354822e1ea3477d22) Thanks [@korone00](https://github.com/korone00)! - Enforce closed public registration for every new-user flow, including social OAuth callbacks, return a stable policy error code, preserve safe authentication return paths, persist exact OAuth callbacks for stable HTTPS development origins, and allow callback-only repair without replacing stored provider credentials.

- Updated dependencies [[`b048480`](https://github.com/podosoft-dev/podokit/commit/b048480b8a35f1e26ad8c1c354822e1ea3477d22)]:
  - @podosoft/podokit-contracts@0.2.1

## 0.6.0

### Minor Changes

- [#90](https://github.com/podosoft-dev/podokit/pull/90) [`b6267eb`](https://github.com/podosoft-dev/podokit/commit/b6267ebc568c01fdf35452c17a00a8d068cdcb36) Thanks [@korone00](https://github.com/korone00)! - Add provider-independent sign-up approval, admin approval controls, social-login buttons, and redacted OAuth/SMTP configuration automation.

### Patch Changes

- Updated dependencies [[`b6267eb`](https://github.com/podosoft-dev/podokit/commit/b6267ebc568c01fdf35452c17a00a8d068cdcb36)]:
  - @podosoft/podokit-contracts@0.2.0
