# @podosoft/podokit-module-blog

## 1.0.2

### Patch Changes

- [#179](https://github.com/podosoft-dev/podokit/pull/179) [`12b51dd`](https://github.com/podosoft-dev/podokit/commit/12b51dd6978db53d89e1983309afc369f90618e9) Thanks [@korone00](https://github.com/korone00)! - Keep the faithful generated-app suite below its shared rate-limit ceiling, surface failed feature-toggle writes directly, and send same-origin headers for browser-context blog deletion checks.

## 1.0.1

### Patch Changes

- [#175](https://github.com/podosoft-dev/podokit/pull/175) [`610e542`](https://github.com/podosoft-dev/podokit/commit/610e542ba32226fc01dc4d2c132b78167da7e5c5) Thanks [@korone00](https://github.com/korone00)! - Bind blog tags as native JSON arrays with Bun SQL, isolate browser authors from
  rate-limit state across repeated test runs, and let SvelteKit page metadata own
  the document title without a conflicting static template title. Use one Elysia
  route parameter name for blog post identifiers and slugs so the router can
  compile every blog endpoint together.

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

## 0.5.0

### Minor Changes

- [#123](https://github.com/podosoft-dev/podokit/pull/123) [`4525328`](https://github.com/podosoft-dev/podokit/commit/4525328016cb3af38f5520ea41e170f6fe59cef6) Thanks [@korone00](https://github.com/korone00)! - Separate the generated admin-only console into the `(admin)` route group, keep `(app)` available for protected product pages, and migrate existing admin routes safely during `podo update`.

- [#119](https://github.com/podosoft-dev/podokit/pull/119) [`cd7e13b`](https://github.com/podosoft-dev/podokit/commit/cd7e13b7a93b4fea7588ffed87c82ac5be8073ee) Thanks [@korone00](https://github.com/korone00)! - Show the shared signed-in account menu across blog pages and document the owned route-wrapper changes required when upgrading from 0.3.x to 0.4.x.

## 0.4.0

### Minor Changes

- [#115](https://github.com/podosoft-dev/podokit/pull/115) [`8a19cc6`](https://github.com/podosoft-dev/podokit/commit/8a19cc6a93caf293debf80be646ded4b2a6b6690) Thanks [@korone00](https://github.com/korone00)! - Start posts as private drafts, add author visibility controls and cover image uploads, and preserve the original publication time when posts are hidden and shown again.

## Unreleased

### Minor Changes

- Start posts as private drafts, add author draft management and cover image uploads,
  and preserve the original publication time when visibility changes.

## 0.3.1

### Patch Changes

- [#108](https://github.com/podosoft-dev/podokit/pull/108) [`752ae13`](https://github.com/podosoft-dev/podokit/commit/752ae13e6d379dbc0db03faae694d8119f92c1f9) Thanks [@korone00](https://github.com/korone00)! - Return 503 for protected pages when session or site policy checks cannot reach the backend, while preserving session cookies and public-page fallbacks.

## 0.3.0

### Minor Changes

- [#99](https://github.com/podosoft-dev/podokit/pull/99) [`b048480`](https://github.com/podosoft-dev/podokit/commit/b048480b8a35f1e26ad8c1c354822e1ea3477d22) Thanks [@korone00](https://github.com/korone00)! - Add split JSON locale catalogs, runtime fallback composition, locale management commands, and a generated locale workflow skill.

## 0.2.1

### Patch Changes

- [#85](https://github.com/podosoft-dev/podokit/pull/85) [`1b951ca`](https://github.com/podosoft-dev/podokit/commit/1b951ca439c7bd4b8ca5d467d79298dad91c3420) Thanks [@korone00](https://github.com/korone00)! - Stabilize the publishing UI test and require the exact created post URL before validating rendered Markdown.

## 0.2.0

### Minor Changes

- [#83](https://github.com/podosoft-dev/podokit/pull/83) [`c9d9bdf`](https://github.com/podosoft-dev/podokit/commit/c9d9bdf19c8b6ab77fcef8e619c0ccb79458ef8d) Thanks [@korone00](https://github.com/korone00)! - Publish the blog module with authenticated authoring, ownership-aware deletion, pagination, comments, Markdown previews, and image uploads.
