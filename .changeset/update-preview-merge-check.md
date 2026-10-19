---
"@podosoft/podokit": patch
---

Check merges for conflicts in the `podo update` preview without `--from`. The preview ran the 3-way merges only when `--from` gave the previous templates, so it could report `0 conflict` for a merge that `--apply` then wrote with conflict markers, such as an app's dependency added on the line above one the template raised in `apps/api/package.json`. The preview now merges against the same base as `--apply` (`--from`, the installed templates, or the recorded version's templates installed from npm) and shows such a file as `conflict`. When it cannot get that base, it still lists the merges and prints `WARN the N merge(s) were not checked` with the reason and a `--from` hint.
