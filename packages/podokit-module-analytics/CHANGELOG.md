# @podosoft/podokit-module-analytics

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
