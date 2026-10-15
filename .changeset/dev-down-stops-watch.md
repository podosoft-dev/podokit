---
"@podosoft/podokit": patch
---

`podo dev down` stops the Compose Watch that `podo dev watch` started for the same project before removing the stack. The watch kept running after `down` and held Compose's per-project lock, so the next `podo dev watch` failed with "cannot take exclusive lock" until the process was killed by hand. The watch is found by the project's own `.podokit/runtime/dev.compose.yaml` path, so other projects' watches and the shared gateway are untouched, and the stopped `podo dev watch` exits successfully with "Stopped watching." instead of an error.
