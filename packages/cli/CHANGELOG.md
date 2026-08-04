# @podosoft/podokit

## 0.17.3

### Patch Changes

- [#150](https://github.com/podosoft-dev/podokit/pull/150) [`5c85c4a`](https://github.com/podosoft-dev/podokit/commit/5c85c4a1bdcd3f1a12cd913c53412a9b48e18480) Thanks [@korone00](https://github.com/korone00)! - Add a detached `podo dev up` lifecycle command, restore shared gateway routing when refreshing generated development apps, remove stale routes when a project's local hostname changes, and seed newly introduced owned files without overwriting existing application paths.

## 0.17.2

### Patch Changes

- [#148](https://github.com/podosoft-dev/podokit/pull/148) [`1be595c`](https://github.com/podosoft-dev/podokit/commit/1be595c6af3d7e9ab13e8a38ccea1b95441e8f96) Thanks [@korone00](https://github.com/korone00)! - Explain when an account session is too old to list other sessions and offer a direct
  sign-in action instead of showing the upstream error in a toast.

## 0.17.1

### Patch Changes

- [#145](https://github.com/podosoft-dev/podokit/pull/145) [`38a7226`](https://github.com/podosoft-dev/podokit/commit/38a72268da361f19125179e1b3b02fa76bfebc51) Thanks [@korone00](https://github.com/korone00)! - Confirm a new password when resetting it or changing it from the account page.

  Both forms took the new password once. A reset spends a single-use token, so a typo
  costs another trip through the mailbox; a change from the account page simply
  succeeds, and the mistake surfaces at the next sign-in with a password the person
  cannot reproduce.

- [#146](https://github.com/podosoft-dev/podokit/pull/146) [`dbb3dab`](https://github.com/podosoft-dev/podokit/commit/dbb3dabe82ab45de80aee7554028b8d2e5c14694) Thanks [@korone00](https://github.com/korone00)! - Stop the e2e suite from depending on a seeded account's password, and fix the
  change-password spec that could never pass.

  `tests/helpers/accounts.ts` hardcoded the seed password, so the suite could only
  sign in on a stack it had created itself. Against an install bootstrapped with
  `admin:bootstrap`, `admin@example.com` is a real account with a password somebody
  uses — and the only way to make the run green was to reset that account to match
  the constant, which takes their login with it. The passwords now read
  `E2E_ADMIN_PASSWORD` / `E2E_USER_PASSWORD` and fall back to the seed value, so an
  existing account is told to the suite instead of altered. Without the override the
  run fails with `INVALID_EMAIL_OR_PASSWORD` — a refusal rather than a silent
  overwrite. The two-factor and account specs that signed in as the shared accounts
  now use the same constants.

  The spec asserting that a mistyped password confirmation is refused clicked a
  button named `Update`; the button is `Update password`, so the test timed out
  before reaching its assertion and had never passed. It now clicks the real button
  and first asserts the error is absent, so a form that showed it unconditionally
  would still fail.

- [#143](https://github.com/podosoft-dev/podokit/pull/143) [`62fe5da`](https://github.com/podosoft-dev/podokit/commit/62fe5dac532c6a44552922407fb3dd56bd4dd0dc) Thanks [@korone00](https://github.com/korone00)! - Confirm the password when signing up.

  Sign-up took the password once, while every form where an administrator sets someone
  else's asks twice. It is the worst place for the omission: a mistyped sign-up costs
  the account, because the address is not verified yet and the reset link that would
  rescue it goes to an inbox the person cannot open.

## 0.17.0

### Minor Changes

- [#141](https://github.com/podosoft-dev/podokit/pull/141) [`ecdd80a`](https://github.com/podosoft-dev/podokit/commit/ecdd80a4bd3bb63c18374a49cb5e0327c455ec4f) Thanks [@korone00](https://github.com/korone00)! - Add `podo deploy sync` and a release workflow for generated projects.

  `podo deploy sync` copies a project's build output into the containers a Compose
  deployment is already running and restarts them, so iterating against a deployment
  does not need a full image round trip. It is deliberately not a release: the image
  tag is unchanged, a marker records the drift, `podo deploy status` reports it as
  `syncDrift`, and the next apply discards it. It refuses when runtime dependencies
  have changed, when a release holds the lock, or when a restarted container does not
  become healthy, and it never runs migrations. A profile can name build outputs to
  leave alone with `sync.exclude`.

  Generated projects now ship `.github/workflows/release.yml`, which builds and pushes
  both images on a `vX.Y.Z` tag. Its runner is a variable rather than a constant,
  because GitHub-hosted minutes are free only for public repositories and image builds
  are the most expensive job most projects run.

- [#139](https://github.com/podosoft-dev/podokit/pull/139) [`6561d7d`](https://github.com/podosoft-dev/podokit/commit/6561d7d561d78f7eb7b908694669b61870e97770) Thanks [@korone00](https://github.com/korone00)! - Add a `docker-compose` deployment driver alongside `kubernetes-helm`, and fix the
  production images.

  `podo deploy` now operates a Compose project on one Docker host — local or over
  `ssh://` — with the same contract the Kubernetes driver has: a fingerprinted target,
  image tags resolved to digests, a confirmation hash that apply must echo back, a
  release-scoped lock, an exact-image migration before rollout, public verification, and
  rollback. A profile declares its own `driver`, so every command after `init` reads it
  from the profile, and the MCP tools follow it too.

  The production Dockerfiles were only buildable for the template's own three
  workspaces. They now collect every workspace manifest, carry the whole install output
  into the build, compile local `packages/*` before the app that imports them, install
  the npm major that wrote the lockfile, prune the runtime tree, declare a healthcheck,
  and keep `.env` out of the build context.

  Generated projects now ship an upgrade-capable web entry point. A SvelteKit route
  cannot answer a WebSocket upgrade, so an API gateway was unreachable once deployed;
  `apps/web/server.js` keeps adapter-node in charge and relays the exact paths named in
  `WS_PROXY_PATHS`, matched whole. Nothing is forwarded by default.

  The example `infra/k3s` manifests no longer contradict the deployment tooling: they
  carry probes, an `ingressClassName`, a TLS block, placeholder tags instead of
  `latest`, and a README saying `podo deploy` renders the manifests it actually applies.

### Patch Changes

- [#142](https://github.com/podosoft-dev/podokit/pull/142) [`aa06b1d`](https://github.com/podosoft-dev/podokit/commit/aa06b1dd5b6ecfde8371041c5253ff14328e211a) Thanks [@korone00](https://github.com/korone00)! - Show the real device on a session, and build the dev image for a project with
  shared packages.

  The server proxy did not forward `user-agent`, and fetch supplies its own default
  when the header is absent — so every session recorded "node" and the account page
  showed that as the device for all of them. The proxy now forwards it, and the
  sessions tables render a readable name ("Chrome · macOS") with the exact string on
  hover, falling back to the raw value for anything that is not a browser.

  `Dockerfile.dev` also listed workspace manifests by hand and never built the
  workspace packages. Both are invisible to a project with only the template's own
  workspaces and fatal to one that adds `packages/*`: npm looked for local packages on
  the public registry, and the API died on MODULE_NOT_FOUND for a package whose
  symlink resolved to a `dist` that was never compiled.

## 0.16.4

### Patch Changes

- [#137](https://github.com/podosoft-dev/podokit/pull/137) [`d6033e5`](https://github.com/podosoft-dev/podokit/commit/d6033e513b1b90224c0a06b4deb3767d62ecd4c0) Thanks [@korone00](https://github.com/korone00)! - Allow deployment profiles to override the exact API migration command while preserving the existing default.

- [#137](https://github.com/podosoft-dev/podokit/pull/137) [`d6033e5`](https://github.com/podosoft-dev/podokit/commit/d6033e513b1b90224c0a06b4deb3767d62ecd4c0) Thanks [@korone00](https://github.com/korone00)! - Keep generated SvelteKit proxies available when the trusted proxy address chain is absent or shorter than configured.

## 0.16.3

### Patch Changes

- [#135](https://github.com/podosoft-dev/podokit/pull/135) [`092d932`](https://github.com/podosoft-dev/podokit/commit/092d932de128192809772df002c2456891d208a9) Thanks [@korone00](https://github.com/korone00)! - Label object storage initialization Jobs so deployment lifecycle selectors find them.

## 0.16.2

### Patch Changes

- [#133](https://github.com/podosoft-dev/podokit/pull/133) [`e68d849`](https://github.com/podosoft-dev/podokit/commit/e68d849eab52ee41a3aa96f3b84b0334a28ab041) Thanks [@korone00](https://github.com/korone00)! - Nest explicit storage class names correctly in rendered persistent volume claims.

## 0.16.1

### Patch Changes

- [#131](https://github.com/podosoft-dev/podokit/pull/131) [`07c7250`](https://github.com/podosoft-dev/podokit/commit/07c725084585facc176f12d97a65b8745e5615d2) Thanks [@korone00](https://github.com/korone00)! - Write Kubernetes Lease timestamps with the six fractional digits required by MicroTime.

- [#131](https://github.com/podosoft-dev/podokit/pull/131) [`23c2d79`](https://github.com/podosoft-dev/podokit/commit/23c2d7942edd74c63003f6faf3efd9e71d258449) Thanks [@korone00](https://github.com/korone00)! - Apply module requirements introduced by a newer PodoKit version during `podo update` so existing projects receive complete dependency graphs instead of partial generated imports.

## 0.16.0

### Minor Changes

- [#129](https://github.com/podosoft-dev/podokit/pull/129) [`7698c8a`](https://github.com/podosoft-dev/podokit/commit/7698c8a803908b9cf7efd093e0d8bf78e0d6db9a) Thanks [@korone00](https://github.com/korone00)! - Add an external analytics module with provider-neutral events, GA4 collection
  and aggregate reports, advanced consent mode, encrypted administrator
  configuration, and a managed site-runtime injection point.

  Publish and install the external analytics package in the faithful generated-app
  Outer path so its package contents, injections, migrations, and shipped tests
  participate in release-gate validation.

  Make `podo remove` fully reverse multi-line module injections and discard
  module-owned globs when no preserved edited file or other module still needs
  them. Treat the project manifest as authoritative when resolving already
  installed dependencies so adding an external module cannot re-overlay a
  customized required module.

- [#129](https://github.com/podosoft-dev/podokit/pull/129) [`7698c8a`](https://github.com/podosoft-dev/podokit/commit/7698c8a803908b9cf7efd093e0d8bf78e0d6db9a) Thanks [@korone00](https://github.com/korone00)! - Add guarded Kubernetes deployment profiles, deterministic Helm render and plan
  operations, exact-image migrations, confirmation-hash apply and rollback,
  deployment status and verification, plus read-only MCP inspection tools and a
  generated deployment skill.

  Add authenticated Redis connection settings, multi-replica Redis SSE delivery,
  extensible readiness checks, shared distributed rate limiting with a single
  managed application identity extension point, explicit adoption of existing
  Redis and rate-limit implementations, and production k3s ingress and readiness
  corrections. Development commands now activate Compose profiles required by the
  installed module graph.

### Patch Changes

- Updated dependencies [[`7698c8a`](https://github.com/podosoft-dev/podokit/commit/7698c8a803908b9cf7efd093e0d8bf78e0d6db9a)]:
  - @podosoft/podokit-template-engine@0.4.2

## 0.15.0

### Minor Changes

- [#127](https://github.com/podosoft-dev/podokit/pull/127) [`f174097`](https://github.com/podosoft-dev/podokit/commit/f1740974d833bdf00ef6e9dba37daf834c77fd8f) Thanks [@korone00](https://github.com/korone00)! - Add application-owned Playwright projects, reusable product-shell identity menus, and responsive DataTable column helpers. Keep generated admin tests repeatable by cleaning up disposable users and pinning their UI locale, and stop `podo update` from restoring explicitly ejected files after applications relocate them.

## 0.14.0

### Minor Changes

- [#121](https://github.com/podosoft-dev/podokit/pull/121) [`820a4c5`](https://github.com/podosoft-dev/podokit/commit/820a4c5eb7c5553f749591e4e25dfc9318d77c3f) Thanks [@korone00](https://github.com/korone00)! - Show the shared language and light/dark theme controls beside the signed-in account menu on generated landing pages.

- [#123](https://github.com/podosoft-dev/podokit/pull/123) [`4525328`](https://github.com/podosoft-dev/podokit/commit/4525328016cb3af38f5520ea41e170f6fe59cef6) Thanks [@korone00](https://github.com/korone00)! - Separate the generated admin-only console into the `(admin)` route group, keep `(app)` available for protected product pages, and migrate existing admin routes safely during `podo update`.

- [#119](https://github.com/podosoft-dev/podokit/pull/119) [`cd7e13b`](https://github.com/podosoft-dev/podokit/commit/cd7e13b7a93b4fea7588ffed87c82ac5be8073ee) Thanks [@korone00](https://github.com/korone00)! - Add self-service profile-image upload, replacement, removal, shared validation limits, multipart API client support, and a reusable signed-in account menu for generated landing pages.

### Patch Changes

- [#121](https://github.com/podosoft-dev/podokit/pull/121) [`820a4c5`](https://github.com/podosoft-dev/podokit/commit/820a4c5eb7c5553f749591e4e25dfc9318d77c3f) Thanks [@korone00](https://github.com/korone00)! - Use the file-list binding without a conflicting value binding and forward change events explicitly from the generated shared input component so file upload controls work reliably.

## 0.13.0

### Minor Changes

- [#114](https://github.com/podosoft-dev/podokit/pull/114) [`b05637f`](https://github.com/podosoft-dev/podokit/commit/b05637f68518080cf88bca87a79a8b9aae1aee25) Thanks [@korone00](https://github.com/korone00)! - Add a live automatic-logout policy with validated idle durations, sliding Better Auth session expiration, existing-session updates, cross-tab browser inactivity handling, and localized admin controls.

### Patch Changes

- [#112](https://github.com/podosoft-dev/podokit/pull/112) [`2940f05`](https://github.com/podosoft-dev/podokit/commit/2940f0590e6d64b16b2dcdd49413789f5acb2143) Thanks [@korone00](https://github.com/korone00)! - Align the generated admin dashboard navigation test with the public account route
  and keep `@smoke` focused on critical cross-module paths while the default suite
  retains full coverage.

## 0.12.4

### Patch Changes

- [#110](https://github.com/podosoft-dev/podokit/pull/110) [`2d0d99b`](https://github.com/podosoft-dev/podokit/commit/2d0d99b0717c2cbd9038b91b93c86fe98783e653) Thanks [@korone00](https://github.com/korone00)! - Keep admin dashboard route server loaders update-managed while preserving application-owned route presentation and root layouts.

## 0.12.3

### Patch Changes

- [#108](https://github.com/podosoft-dev/podokit/pull/108) [`752ae13`](https://github.com/podosoft-dev/podokit/commit/752ae13e6d379dbc0db03faae694d8119f92c1f9) Thanks [@korone00](https://github.com/korone00)! - Return 503 for protected pages when session or site policy checks cannot reach the backend, while preserving session cookies and public-page fallbacks.

## 0.12.2

### Patch Changes

- [#103](https://github.com/podosoft-dev/podokit/pull/103) [`ad6d0dc`](https://github.com/podosoft-dev/podokit/commit/ad6d0dc1fe216397f26a95b522706c1ed4083e2f) Thanks [@korone00](https://github.com/korone00)! - Reconstruct three-way merge bases with the external module versions recorded in the project manifest.

## 0.12.1

### Patch Changes

- [#101](https://github.com/podosoft-dev/podokit/pull/101) [`5fb7791`](https://github.com/podosoft-dev/podokit/commit/5fb7791b3af8a6f4a2bc90e77e88c089841500e9) Thanks [@korone00](https://github.com/korone00)! - Report an actionable error when a three-way update uses previous templates after an external module was already upgraded.

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
