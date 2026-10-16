---
"@podosoft/podokit": minor
"@podosoft/podokit-module-analytics": patch
---

Let generated apps run their Playwright suite on more than one worker. `E2E_WORKERS` sets the worker count (default 1), for example `E2E_WORKERS=2 bun run test:e2e`. Tests tagged `@exclusive`, which change state the other tests rely on, run in `<project>-exclusive` twins on one worker, and with more than one worker after every other test, one twin after another. The managed specs that change feature flags, the authentication configuration, the site settings, module settings such as analytics, or the seeded administrator's profile carry the tag, and projects from `tests/playwright.projects.cjs` get twins too. `test:e2e:api` and `test:e2e:ui` include the twins, and the global setup refuses `--workers` above 1 unless `E2E_WORKERS` is set. The `exclusive()` lock helper and its self-test are removed: its locks kept apart only the specs that changed the same setting, not the specs that relied on the default.
