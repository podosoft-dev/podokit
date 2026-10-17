---
"@podosoft/podokit": patch
---

Run the tests tagged `@exclusive` in a second Playwright run when `E2E_WORKERS` is above 1. The `test:e2e` scripts start the suite through the new `tests/run-e2e.ts`, so a failing test no longer leaves the exclusive tests not run, and the suite still fails when either run fails.
