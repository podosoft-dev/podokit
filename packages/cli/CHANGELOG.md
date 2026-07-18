# @podosoft/podokit

## 0.12.0

### Minor Changes

- [#99](https://github.com/podosoft-dev/podokit/pull/99) [`b048480`](https://github.com/podosoft-dev/podokit/commit/b048480b8a35f1e26ad8c1c354822e1ea3477d22) Thanks [@korone00](https://github.com/korone00)! - Add split JSON locale catalogs, runtime fallback composition, locale management commands, and a generated locale workflow skill.

- [#99](https://github.com/podosoft-dev/podokit/pull/99) [`b048480`](https://github.com/podosoft-dev/podokit/commit/b048480b8a35f1e26ad8c1c354822e1ea3477d22) Thanks [@korone00](https://github.com/korone00)! - Add `podo dev` with a socket-free shared loopback gateway, project-owned portless hostnames, Compose lifecycle helpers, and browser-origin HMR that also works through provider-neutral HTTPS tunnels.

### Patch Changes

- [#99](https://github.com/podosoft-dev/podokit/pull/99) [`b048480`](https://github.com/podosoft-dev/podokit/commit/b048480b8a35f1e26ad8c1c354822e1ea3477d22) Thanks [@korone00](https://github.com/korone00)! - Preserve a selected locale during SSR even when an application owns a non-English
  default or additional document attributes in `app.html`.

- [#99](https://github.com/podosoft-dev/podokit/pull/99) [`b048480`](https://github.com/podosoft-dev/podokit/commit/b048480b8a35f1e26ad8c1c354822e1ea3477d22) Thanks [@korone00](https://github.com/korone00)! - Enforce closed public registration for every new-user flow, including social OAuth callbacks, return a stable policy error code, preserve safe authentication return paths, persist exact OAuth callbacks for stable HTTPS development origins, and allow callback-only repair without replacing stored provider credentials.

- [#99](https://github.com/podosoft-dev/podokit/pull/99) [`b048480`](https://github.com/podosoft-dev/podokit/commit/b048480b8a35f1e26ad8c1c354822e1ea3477d22) Thanks [@korone00](https://github.com/korone00)! - Stop services from every Compose profile when running `podo dev down`.

- [#99](https://github.com/podosoft-dev/podokit/pull/99) [`b048480`](https://github.com/podosoft-dev/podokit/commit/b048480b8a35f1e26ad8c1c354822e1ea3477d22) Thanks [@korone00](https://github.com/korone00)! - Show the application default in General Settings when the stored site locale is empty.

- [#99](https://github.com/podosoft-dev/podokit/pull/99) [`b048480`](https://github.com/podosoft-dev/podokit/commit/b048480b8a35f1e26ad8c1c354822e1ea3477d22) Thanks [@korone00](https://github.com/korone00)! - Promote newly declared default-owned paths during update so project-specific
  configuration remains untouched.

## 0.11.2

### Patch Changes

- [#95](https://github.com/podosoft-dev/podokit/pull/95) [`05fc8a8`](https://github.com/podosoft-dev/podokit/commit/05fc8a87b4f6ca3c4247eeaebaf42e2d206d91d5) Thanks [@korone00](https://github.com/korone00)! - Add an idempotent, secret-safe initial administrator bootstrap command, keep its generated authentication skill update-managed, and include generated operator scripts in API runtime images.

## 0.11.1

### Patch Changes

- [#92](https://github.com/podosoft-dev/podokit/pull/92) [`63a1a4e`](https://github.com/podosoft-dev/podokit/commit/63a1a4ed14828d951d8709f0843c284ab8fd160f) Thanks [@korone00](https://github.com/korone00)! - Update generated app and module dependency ranges to install the package versions required by the sign-up approval APIs.

## 0.11.0

### Minor Changes

- [#90](https://github.com/podosoft-dev/podokit/pull/90) [`b6267eb`](https://github.com/podosoft-dev/podokit/commit/b6267ebc568c01fdf35452c17a00a8d068cdcb36) Thanks [@korone00](https://github.com/korone00)! - Add provider-independent sign-up approval, admin approval controls, social-login buttons, and redacted OAuth/SMTP configuration automation.

## 0.10.2

### Patch Changes

- [#87](https://github.com/podosoft-dev/podokit/pull/87) [`829ef6c`](https://github.com/podosoft-dev/podokit/commit/829ef6c3bfe6d5408c0a20028672f05c95cc7886) Thanks [@korone00](https://github.com/korone00)! - Keep generated liveness and readiness endpoints outside the global rate-limit quota.

## 0.10.1

### Patch Changes

- [#85](https://github.com/podosoft-dev/podokit/pull/85) [`1b951ca`](https://github.com/podosoft-dev/podokit/commit/1b951ca439c7bd4b8ca5d467d79298dad91c3420) Thanks [@korone00](https://github.com/korone00)! - Add a compiled production migration command that applies Better Auth and TypeORM schemas for container deployment jobs.

- [#85](https://github.com/podosoft-dev/podokit/pull/85) [`1b951ca`](https://github.com/podosoft-dev/podokit/commit/1b951ca439c7bd4b8ca5d467d79298dad91c3420) Thanks [@korone00](https://github.com/korone00)! - Stabilize generated admin smoke tests across hydrated tabs, settings saves, and application-owned landing pages.

- [#85](https://github.com/podosoft-dev/podokit/pull/85) [`1b951ca`](https://github.com/podosoft-dev/podokit/commit/1b951ca439c7bd4b8ca5d467d79298dad91c3420) Thanks [@korone00](https://github.com/korone00)! - Build generated API and web production images reproducibly from the root npm workspace lockfile and align their runtime with the authentication stack's Node.js requirement.

- [#85](https://github.com/podosoft-dev/podokit/pull/85) [`1b951ca`](https://github.com/podosoft-dev/podokit/commit/1b951ca439c7bd4b8ca5d467d79298dad91c3420) Thanks [@korone00](https://github.com/korone00)! - Return HTTP 503 from generated API readiness probes when PostgreSQL is unavailable.

- [#85](https://github.com/podosoft-dev/podokit/pull/85) [`1b951ca`](https://github.com/podosoft-dev/podokit/commit/1b951ca439c7bd4b8ca5d467d79298dad91c3420) Thanks [@korone00](https://github.com/korone00)! - Track rate limits by the resolved visitor address, configure the trusted Traefik hop, avoid redundant runtime lookups, and protect critical SSR settings reads with a separate ceiling.

## 0.10.0

### Minor Changes

- [#83](https://github.com/podosoft-dev/podokit/pull/83) [`c9d9bdf`](https://github.com/podosoft-dev/podokit/commit/c9d9bdf19c8b6ab77fcef8e619c0ccb79458ef8d) Thanks [@korone00](https://github.com/korone00)! - Add a signed-in user account page and reusable avatar menu while retaining the existing admin account route.

- [#83](https://github.com/podosoft-dev/podokit/pull/83) [`c9d9bdf`](https://github.com/podosoft-dev/podokit/commit/c9d9bdf19c8b6ab77fcef8e619c0ccb79458ef8d) Thanks [@korone00](https://github.com/korone00)! - Support versioned external package modules during `podo update`, add explicit managed-path adoption with `podo add --adopt`, preserve pre-existing application drift and unrelated files when refreshing the generated lock, and route global module behavior through a managed site-runtime slot without replacing app-owned pages.

### Patch Changes

- [#83](https://github.com/podosoft-dev/podokit/pull/83) [`c9d9bdf`](https://github.com/podosoft-dev/podokit/commit/c9d9bdf19c8b6ab77fcef8e619c0ccb79458ef8d) Thanks [@korone00](https://github.com/korone00)! - Preserve user edits across repeated updates by keeping the assembled template as the managed lock baseline after a 3-way merge.

- [#83](https://github.com/podosoft-dev/podokit/pull/83) [`c9d9bdf`](https://github.com/podosoft-dev/podokit/commit/c9d9bdf19c8b6ab77fcef8e619c0ccb79458ef8d) Thanks [@korone00](https://github.com/korone00)! - Simplify the generated admin Appearance screen with focused preset choices, practical quick settings, and a larger theme preview while keeping every existing theme key and setting compatible.

- [#83](https://github.com/podosoft-dev/podokit/pull/83) [`c9d9bdf`](https://github.com/podosoft-dev/podokit/commit/c9d9bdf19c8b6ab77fcef8e619c0ccb79458ef8d) Thanks [@korone00](https://github.com/korone00)! - Prevent search engines from indexing generated admin, account, authentication, maintenance, and API routes.

- [#83](https://github.com/podosoft-dev/podokit/pull/83) [`c9d9bdf`](https://github.com/podosoft-dev/podokit/commit/c9d9bdf19c8b6ab77fcef8e619c0ccb79458ef8d) Thanks [@korone00](https://github.com/korone00)! - Ignore Playwright authentication, report, and test-result artifacts from both configured and root execution paths, plus local Lighthouse reports.

- [#83](https://github.com/podosoft-dev/podokit/pull/83) [`c9d9bdf`](https://github.com/podosoft-dev/podokit/commit/c9d9bdf19c8b6ab77fcef8e619c0ccb79458ef8d) Thanks [@korone00](https://github.com/korone00)! - Wait for Svelte login hydration in the generated two-factor Playwright tests.

- [#83](https://github.com/podosoft-dev/podokit/pull/83) [`c9d9bdf`](https://github.com/podosoft-dev/podokit/commit/c9d9bdf19c8b6ab77fcef8e619c0ccb79458ef8d) Thanks [@korone00](https://github.com/korone00)! - Enable Traefik response compression in generated container and k3s ingress configurations.
