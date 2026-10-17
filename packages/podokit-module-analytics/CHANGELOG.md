# @podosoft/podokit-module-analytics

## 1.1.2

### Patch Changes

- [#238](https://github.com/podosoft-dev/podokit/pull/238) [`a514856`](https://github.com/podosoft-dev/podokit/commit/a514856c2b2434bbd6904d33caff8206652a2bff) Thanks [@korone00](https://github.com/korone00)! - Let generated apps run their Playwright suite on more than one worker. `E2E_WORKERS` sets the worker count (default 1), for example `E2E_WORKERS=2 bun run test:e2e`. Tests tagged `@exclusive`, which change state the other tests rely on, run in `<project>-exclusive` twins on one worker, and with more than one worker after every other test, one twin after another. The managed specs that change feature flags, the authentication configuration, the site settings, module settings such as analytics, or the seeded administrator's profile carry the tag, and projects from `tests/playwright.projects.cjs` get twins too. `test:e2e:api` and `test:e2e:ui` include the twins, and the global setup refuses `--workers` above 1 unless `E2E_WORKERS` is set. The `exclusive()` lock helper and its self-test are removed: its locks kept apart only the specs that changed the same setting, not the specs that relied on the default.

## 1.1.1

### Patch Changes

- [#225](https://github.com/podosoft-dev/podokit/pull/225) [`76ac9ea`](https://github.com/podosoft-dev/podokit/commit/76ac9ea4ec3f757e94aa874424695ccaff8f3b92) Thanks [@korone00](https://github.com/korone00)! - Use `bun run --cwd apps/api migrate:all` in the install instructions, so a new database gets the Better Auth tables that the required admin dashboard needs.

## 1.1.0

### Minor Changes

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - Ship the shadcn-svelte `textarea` in the generated UI set at `apps/web/src/lib/components/ui/textarea`, vendored from the official registry for the template's `nova` style like the other primitives. `components.json` now maps the `utils`, `hooks`, and `lib` aliases to the `#lib` import map, so `bunx --bun shadcn-svelte@latest add <component>` works in a generated app; it stopped with an invalid `hooks` alias and wrote `#lib/utils.js.js` imports before. The blog and analytics modules no longer ship their own textarea copy, which `podo remove` could delete from under other pages; they declare the shared component as a required project file, so `podo add` asks an older project to run `podo update --apply` first.

## 1.0.0

### Major Changes

- [#171](https://github.com/podosoft-dev/podokit/pull/171) [`46352bc`](https://github.com/podosoft-dev/podokit/commit/46352bc6187dcc1aabff86789c214ccf7efad36a) Thanks [@korone00](https://github.com/korone00)! - Generate Bun 1.4.0 applications with an Elysia request path, native Bun SQL,
  Redis, and S3 integrations, Alpine production images, merged OpenAPI documents,
  and executable endpoint-contract verification.

  Replace the former runtime-selection and conversion surface with a Bun-only v1
  project model. Existing PodoKit 0.x applications must remain on the final 0.x
  CLI instead of being converted in place.

  Port the Blog and Analytics external modules to the Elysia service registry and
  Bun SQL while preserving their documented HTTP behavior and UI features.

### Patch Changes

- [#174](https://github.com/podosoft-dev/podokit/pull/174) [`d010fd9`](https://github.com/podosoft-dev/podokit/commit/d010fd9466617d4219a0573eefa90031066df3fb) Thanks [@korone00](https://github.com/korone00)! - Complete SvelteKit 3 package-import migration and synchronize self-contained web builds safely.

## 0.1.1

### Patch Changes

- [#131](https://github.com/podosoft-dev/podokit/pull/131) [`90a98e0`](https://github.com/podosoft-dev/podokit/commit/90a98e07bf94197622b86b67e811ed16b64aa8b9) Thanks [@korone00](https://github.com/korone00)! - Add a scrollable administrator guide for issuing and securing Google Analytics 4 credentials.

- [#131](https://github.com/podosoft-dev/podokit/pull/131) [`62c951b`](https://github.com/podosoft-dev/podokit/commit/62c951b591c53a051f778661897f637beda9faa4) Thanks [@korone00](https://github.com/korone00)! - Keep the generated analytics consent persistence test from clearing its stored choice again during reload.

## 0.1.0

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
