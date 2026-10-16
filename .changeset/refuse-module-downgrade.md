---
"@podosoft/podokit": patch
---

Refuse `podo update --apply`, and warn in the dry run, when an installed external module is older than the version the project last applied, instead of silently downgrading its files.
