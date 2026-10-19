---
"@podosoft/podokit": patch
---

Let generated Playwright suites record a trace when asked, without slowing every run. The managed `tests/playwright.config.ts` now reads the trace mode from `E2E_TRACE` (any Playwright trace mode; another value fails the run with the list of modes). Unset, it stays `on-first-retry` on CI, which retries a failed test twice, and `off` elsewhere; rerun a failed file with `E2E_TRACE=retain-on-failure` to keep its `trace.zip`. Recording a trace of every test and keeping it only for failures made the UI tests on `vite dev` about 30% slower, and those on one worker about 75%. Failed tests still keep a screenshot and `error-context.md`, and the `admin-dashboard` hydration helpers' message now says how to record a trace.
