---
"@podosoft/podokit": patch
---

Make `podo update --apply` 3-way merge edited managed files without `--from`. The merge base is now the templates of the version `.podokit/manifest.json` records: the installed CLI's own when the project is on that version, and otherwise `@podosoft/podokit@<version>` installed from the npm registry into a temporary directory, as previous external modules already were. Before, an update without `--from` left every edited managed file unmerged and reported it as a conflict while the lock and manifest moved on, so its upstream changes were never applied. When the registry cannot provide that version, `--apply` now stops before writing anything and lists the files that need it; `--from <dir>` still takes precedence. Edited files without a merge base, such as one the previous version did not generate or one the new version removes, are listed with the reason as `skipped` instead of as conflicts.
