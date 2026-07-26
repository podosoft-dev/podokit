---
"@podosoft/podokit": minor
"@podosoft/podokit-module-analytics": minor
"@podosoft/podokit-template-engine": patch
---

Add an external analytics module with provider-neutral events, GA4 collection
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
