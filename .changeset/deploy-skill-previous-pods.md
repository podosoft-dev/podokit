---
"@podosoft/podokit": patch
---

Make the generated `podokit-deploy` agent skill report the `previousPods` of `podo deploy status` apart from the current revision's `restartCount`, instead of "restart totals", so an agent does not attribute the restarts of pods that `apply` or `rollback` replaced to the new release.
