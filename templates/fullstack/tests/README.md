# tests

End-to-end tests for this app, run with [`@playwright/test`](https://playwright.dev):

```bash
{{rootRun}} test:e2e         # all specs (api + ui)
{{rootRun}} test:e2e:api     # backend endpoints (request-only)
{{rootRun}} test:e2e:ui      # pages (chromium)
{{rootRun}} test:e2e:report  # open the HTML report
```

The suite runs against a live stack (web on `E2E_BASE_URL`, proxying `/api/*` to
the API). With the recommended containerized loop, start `podo dev watch` and run:

```bash
E2E_BASE_URL=http://{{devHostname}} {{rootRun}} test:e2e
```

The default `http://localhost:5001` is for the alternative `{{rootRun}} dev`
host-process loop. Files ending in `*.api.spec.ts` run in the request-only `api`
project; `*.ui.spec.ts` run in the chromium `ui` project.

## Workers and exclusive tests

The suite runs on one worker unless `E2E_WORKERS` says otherwise. For the whole
suite, more workers finish sooner:

```bash
E2E_WORKERS=2 {{rootRun}} test:e2e
```

Set the count with `E2E_WORKERS`, not `--workers`: the global setup refuses more
than one worker when `E2E_WORKERS` is unset.

Every test shares one API, database, mail catcher, and SMS sink. A test that
changes state other tests rely on takes the `@exclusive` tag:

```ts
test("maintenance mode holds visitors back", { tag: "@exclusive" }, async ({ page }) => {
  // ...
});
```

Tag a test when it changes a server-wide setting (a feature flag, the
authentication configuration such as SMTP, social providers, or sign-up
approval, the site settings, or a module's settings) or the profile of a seeded
account. Each project has an `<name>-exclusive` twin, such as `ui-exclusive`,
that runs only the tagged tests, one at a time. Never empty the shared mail
catcher or SMS sink in a test: send to an address or number of the test's own
instead.

The `test:e2e` scripts run `run-e2e.ts`, which hands its arguments (a file,
`--grep`, `--project`) to Playwright. With more than one worker it runs
Playwright twice: first every test not tagged `@exclusive` on those workers,
then the tagged tests on one worker, even when a test failed in the first run.
The suite fails when either run fails. The second run reports to
`playwright-report/exclusive` and `test-results/exclusive`:

```bash
bunx playwright show-report playwright-report/exclusive
```

A plain `bunx playwright test` with `E2E_WORKERS` above 1 makes one run in which
the twins depend on every other test: a failing test there leaves the exclusive
tests not run, and selecting an exclusive test runs every other test first. Use
`{{rootRun}} test:e2e` on more workers, and do not combine `--no-deps` with
`E2E_WORKERS` above 1.

Application-owned projects in `playwright.projects.cjs` get twins too. A project
that another project depends on is a setup project and keeps a single copy.
