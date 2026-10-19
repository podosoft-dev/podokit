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

## Failed tests

A failed test keeps a screenshot and a page snapshot (`error-context.md`) in
its folder under `test-results/`. Passing tests keep nothing.

A local run records no trace, because recording one for every test makes the UI
tests on the dev server about 30% slower. To get the trace of a failure, rerun
the failed file with `E2E_TRACE=retain-on-failure`:

```bash
E2E_TRACE=retain-on-failure E2E_BASE_URL=http://{{devHostname}} {{rootRun}} test:e2e ui/<file>.ui.spec.ts
bunx playwright show-trace test-results/<test folder>/trace.zip
```

The trace shows each action with the page before and after it, the console, and
the network log of the failed run. `E2E_TRACE` takes any Playwright trace mode.
On CI (`CI` set), which retries a failed test twice, the first retry records a
trace (`on-first-retry`) unless `E2E_TRACE` says otherwise.

The hydration helpers in `helpers/hydration.ts` (`ready`, `hydrated`), which
the `admin-dashboard` module adds, fail at once on a page that cannot hydrate:
SvelteKit's static error page (`src/error.html`), or a page that throws an
uncaught error and has not hydrated five seconds later.
SvelteKit also renders that error page in the browser when hydration fails,
after a page the server answered with 200. The cause is then in the browser: in
the helper's error, the dev server output, and the trace of a rerun with
`E2E_TRACE=retain-on-failure`.

On Linux, a container that starts or stops on the same host changes the
network, and Chromium drops the page's waiting requests with
`net::ERR_NETWORK_CHANGED`. The helpers load such a page once more and add a
`network-changed` annotation to the test; any other failure fails the test.

## Email tests

The email specs that the `admin-dashboard` module adds read messages from the
Mailpit at `MAILPIT_URL` (default `http://localhost:8025`). Before the first one,
each worker has the app send a password reset email to a throwaway account and
waits up to five seconds for it there. When it does not arrive, because the app
has no SMTP or sends to a catcher other than the one on that port, the email
tests skip with that cause. Set `MAILPIT_URL` to the Mailpit that receives the
app's mail to run them, and `E2E_REQUIRE_MAIL=true` to make a missing probe
message fail them instead of skipping.
