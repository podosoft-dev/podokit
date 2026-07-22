# @podosoft/podokit-module-blog

## 0.5.0

### Minor Changes

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
