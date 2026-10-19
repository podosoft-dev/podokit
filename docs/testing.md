# Testing

PodoKit verifies the application users actually receive: a freshly generated Bun
workspace with template/module tests included under `tests/`.

## Runtime boundary

The generated API, worker, builds, migrations, and unit tests use Bun 1.4.0.
SvelteKit build and Vitest run through Bun as well.

Playwright is the single Node-runtime test-tool exception. Playwright's
[official system requirements](https://playwright.dev/docs/intro#system-requirements)
list supported Node releases. The generated scripts therefore use
`bunx playwright`, which respects Playwright's Node shebang. Do not force the
command through Bun with `bunx --bun`.

## Generated project commands

```bash
bun run lint
bun run test
bun run build
bun run --cwd apps/api contract

bun run test:e2e
bun run test:e2e:api
bun run test:e2e:ui
bun run --cwd tests test:e2e:report
```

The unit suite uses `bun test` for the Elysia API and Vitest for SvelteKit.
Playwright specs ending in `*.api.spec.ts` run in the request-only `api`
project, while `*.ui.spec.ts` run in Chromium.

The suite expects a live SvelteKit origin that proxies `/api/*` to Elysia:

```bash
podo dev watch

# In another shell:
E2E_BASE_URL=http://my-app.localhost bun run test:e2e
```

For the host-process layout, start the generated dependencies and application
with the commands in [development.md](development.md), then use the default
`http://localhost:5001` origin.

### Workers and exclusive tests

The suite runs on one worker unless `E2E_WORKERS` sets a count. More workers
finish the whole suite sooner (see [Measured durations](#measured-durations)):

```bash
E2E_WORKERS=2 E2E_BASE_URL=http://my-app.localhost bun run test:e2e
```

Every test shares one API, database, Mailpit inbox, and SMS sink. A test that
changes state other tests rely on carries the `@exclusive` tag:

```ts
test("maintenance mode holds visitors back", { tag: "@exclusive" }, async ({ page }) => {
  // ...
});
```

That covers server-wide settings (feature flags, the authentication
configuration such as SMTP, social providers, sign-up approval, account
deletion, automatic logout, or audit logging, the site settings and favicon,
and module settings such as analytics) and the profile of a seeded account. The
managed config gives every test project an `<name>-exclusive` twin, such as
`api-exclusive` and `ui-exclusive`, that runs only the tagged tests on one
worker. Projects that applications add in `tests/playwright.projects.cjs` get
twins as well, except setup projects that another project depends on. Tests
never empty the shared inbox or sink; each one mails and texts recipients of
its own.

The `test:e2e` scripts start the suite through `tests/run-e2e.ts`, which passes
its arguments (a file, `--grep`, `--project`, and so on) to Playwright. With one
worker it makes a single Playwright run, and the twins need no ordering. With
`E2E_WORKERS` above 1 it makes two runs:

1. The tests not tagged `@exclusive`, on `E2E_WORKERS` workers.
2. The tagged tests, on one worker, after the first run ends, even when a test
   failed there.

The suite fails when either run fails, and each run reports only its own tests:
the first in `tests/playwright-report` and `tests/test-results`, the second in
their `exclusive/` subfolders (`bunx playwright show-report
playwright-report/exclusive`). Both runs start with the setup project and end
with the cleanup project, and a filter applies to both, so a run of a few files
on more workers stays small. A run that finds no tests of one kind passes that
run.

A single `bunx playwright test` with `E2E_WORKERS` above 1 still keeps exclusive
tests apart: each twin depends on every other test project and on the twin
before it. Playwright, though, skips a project whose dependency failed, so one
failing test leaves every exclusive test not run, and it runs dependencies in
full, so selecting an exclusive test runs every other test first. The global
setup warns about this; use `bun run test:e2e` instead. The global setup refuses
`--workers` above 1 without `E2E_WORKERS`, because the projects are already
built by then; do not combine `--no-deps` with `E2E_WORKERS` above 1 either.

Install the browser once from the generated project with:

```bash
bunx playwright install chromium
```

### Failed tests

A failed test keeps a Playwright trace (`trace.zip`), a screenshot, and a page
snapshot (`error-context.md`) in its folder under `tests/test-results`
(`test-results/exclusive` for the exclusive run). The trace holds each action
with the page before and after it, the console, and the network log, so a
failure that does not come back on a rerun can still be examined:

```bash
bunx playwright show-trace test-results/<test folder>/trace.zip
```

The HTML report (`bun run --cwd tests test:e2e:report`) links the same files.
Playwright records the trace of every test and deletes it when the test passes,
so passing runs leave nothing behind. CI retries a failed test twice and keeps
the trace of each failed attempt.

The UI specs of the `admin-dashboard` module wait for hydration with `ready(page,
path)` or `hydrated(page)` from `tests/helpers/hydration.ts`. A page that cannot
hydrate fails that wait at once, instead of at the 30-second test timeout:

- SvelteKit's static error page (`src/error.html`) from the server, which it
  sends when a server hook or the root layout fails. The web server log has the
  cause.
- A page that throws an uncaught error and has not hydrated five seconds later.
  When hydration fails and the root error page cannot load either, for example
  because a request for one of the root layout's modules or message catalogs
  failed, SvelteKit renders `src/error.html` in the browser. The server answered
  the page with 200 and has no error of its own. The dev server prints the
  browser's error (see [browser errors in the dev server
  output](templates.md#browser-errors-in-the-dev-server-output)), and the trace
  has the console and network log.

The error lists the page's URL, status, title, and text, and the page errors,
console errors, and failed requests seen while waiting.

### Email tests

The email specs from the `admin-dashboard` module read messages from the Mailpit
at `MAILPIT_URL` (default `http://localhost:8025`). A Mailpit answering there
does not show that the app under test sends its mail to it: another project's
catcher may hold the port while this app has no SMTP or sends elsewhere. So
before the first email test, each worker signs up a throwaway account, asks the
app for its password reset email, and waits up to five seconds for that message
in Mailpit. When it does not arrive, the email tests skip with the cause, such
as `Mailpit at http://localhost:8025 does not receive this app's mail`. Point
`MAILPIT_URL` at the Mailpit that receives the app's SMTP to run them. With
`E2E_REQUIRE_MAIL=true`, as the faithful harness sets when it wires SMTP, a probe
that fails fails the email tests instead.

## API contract verification

Every generated API exposes merged OpenAPI documents at `/api-docs` and
`/api-docs-json`. Elysia route schemas and Better Auth's dynamically generated
schema are merged into one document.

`bun run --cwd apps/api contract` assembles that real application and fails
when a core, template, or installed-module endpoint is absent. This is the
route-level parity gate used for the Elysia implementation; the
expected inventory is documented in [modules.md](modules.md#api-endpoint-contract).
It also rejects inconsistent parameter names at the same structural path
position, such as combining `/hosts/:id` with `/hosts/:hostId/files`.

A contract pass proves route presence and documentation. It does not replace
behavior tests: new or changed endpoints still need Bun unit/integration coverage
and Playwright API coverage against a live stack.

## Three verification contexts

| Context | Purpose | Package source | Required evidence |
| --- | --- | --- | --- |
| Inner | Fast authoring loop | Local `file:` packages via `dev-app.mjs` | Relevant unit/integration and live feature spec |
| Outer | Faithful merge gate | Packages published to isolated Verdaccio | Fresh create/install/migrate/contract/build/start plus shipped tests |
| Shipped | End-developer project | Public npm packages | The same generated commands and specs |

Inner verification catches behavior quickly but does not prove package contents
or registry resolution. Outer verification uses the same create and install
shape as a user and is the required fresh-install gate.

## Maintainer workflow

### Tier 1: static and unit feedback

Generate a local app and run the affected workspace gates:

```bash
node scripts/dev-app.mjs /tmp/app --add <module>
cd /tmp/app
bun run lint
bun run test
bun run build
bun run --cwd apps/api contract
```

A fresh install resolves the newest `@types/bun`, while existing apps keep the
version their lockfile holds. When a change touches managed TypeScript, also
type-check with the lowest version the template's range allows, as CI does:

```bash
node scripts/oldest-bun-types.mjs /tmp/app
cd /tmp/app && bun install && bun run lint
```

### Tier 2: live feature verification

Run the specific API/browser specs against a standing generated stack:

```bash
cd tests
E2E_BASE_URL=http://app.localhost \
  bunx playwright test api/<feature>.api.spec.ts
```

Use a real migration for the selected database and real Redis/Silo services for
distributed provider modules that depend on them. SQLite, memory, local-file, and
local-job tests must still run through a freshly generated application rather
than only contract fixtures. Authentication work must exercise
cookies or bearer tokens through the web proxy, not only call service classes.

### Tier 3: faithful Outer gate

From the PodoKit monorepo:

```bash
node scripts/e2e-ci.mjs
node scripts/e2e-ci.mjs --smoke
node scripts/e2e-ci.mjs --package-smoke
node scripts/e2e-ci.mjs --grep "magic link"
```

- Full mode runs the complete generated feature matrix.
- `--smoke` runs the risk-based ready-PR subset.
- `--package-smoke` checks publish/install/migrate/contract/build/start without
  repeating the browser matrix; Changesets version PRs use it.
- `--grep` narrows feature scenarios but still performs the faithful package and
  generated-app setup.
- Every mode runs the generated suite through `tests/run-e2e.ts`. The full suite
  runs with `E2E_WORKERS=2`, so a failing test does not keep the exclusive tests
  from running; smoke and `--grep` runs are small and keep one worker. Set
  `E2E_WORKERS` to override either.

The harness publishes the template engine, contracts, auth helpers, API client,
CLI, MCP server, and external modules to Verdaccio. It then uses the real CLI,
installs the generated workspace with Bun 1.4.0, empties the `POSTGRES_DB`
database (it drops and recreates the `public` schema, so point the harness only
at a database it may wipe), runs Better Auth and TypeORM migrations, creates the
seeded administrator with `admin:bootstrap`, verifies the OpenAPI contract,
builds and starts the Bun API and worker plus the SvelteKit server, and runs the
shipped Playwright suite.

The packages it publishes carry the versions of the released ones. npx caches a
package by name and version, not by registry, so the harness runs every npm and
npx command against Verdaccio with an npm cache of its own, `.npm-cache` in the
run's app directory, and Bun with `.bun-cache` beside it. Outer must never leave
a Verdaccio build in the user's `~/.npm/_npx`, where a later
`npx @podosoft/podokit@<version>` would run it as the release. Earlier versions
of the harness installed through that cache and deleted `~/.npm/_npx` at the
start of every run; find an entry they left with
`grep -l "localhost:4873" ~/.npm/_npx/*/package-lock.json` and remove it.

Verdaccio serves the published `@podosoft/*` packages and fetches every other
package from npm. When that fetch fails, Verdaccio answers `404`, and after two
failures it stops asking npm for `fail_timeout`, which
[`scripts/verdaccio.yaml`](../scripts/verdaccio.yaml) shortens to 5 seconds. The
harness therefore retries `bun add` and `bun install` up to twice, after 10 and
30 seconds, when Bun reports a `404` for a package outside `@podosoft`, a
registry `5xx`, `408`, or `429`, or a connection or DNS failure while
downloading. A missing `@podosoft/*` package or version, a `No version matching`
error, or any other status fails at once. A public package that really does not
exist fails after the third attempt.

Optional Mailpit, SMS, Redis, and Silo tests run only when the harness explicitly
configures those services. With `SMTP_HOST` set, the harness also sets
`E2E_REQUIRE_MAIL=true`, so an email spec whose probe message does not arrive
in Mailpit fails instead of skipping. When `S3_ENDPOINT` is configured, storage
failures fail the smoke test, and the storage and chunked upload specs also
download their objects through the presigned URL. Without it, they skip that
download, because a containerized dev stack signs URLs for an in-network host
that the runner cannot resolve. Local storage returns a signed API path, which is always downloaded.
`KEEP=1` preserves the generated app for inspection.
Ports and backing-service credentials can be overridden with the documented
`E2E_*`, `POSTGRES_*`, Redis, and S3 environment variables. The shared suite's
general request ceiling defaults to 1000; override it with
`E2E_RATE_LIMIT_MAX` when extending or diagnosing the matrix. The rate-limit
spec uses that same value so it still verifies a real 200-to-429 transition.

### Measured durations

Steps that take about 10 minutes or more are investigated and shortened (see
[Long-running steps](../CONTRIBUTING.md#long-running-steps)). These numbers were
measured on an 8-core, 16 GB Linux VM with warm npm and Bun caches; update them
when a step's duration changes noticeably.

| Step | Duration | Measured |
| --- | --- | --- |
| `node scripts/dev-app.mjs <dir> --add <12 modules>` | 13 s, of which the monorepo build 10 s | 2026-10-16 |
| Tier 2 standing stack from that app: database, migrations, contract, and web build | 5 to 12 s | 2026-10-16 |
| Starting its API and built web server until both answer | 1.1 s | 2026-10-16 |
| `node scripts/e2e-ci.mjs --package-smoke` | 42 s | 2026-10-16 |
| `node scripts/e2e-ci.mjs --smoke` | 77 to 95 s | 2026-10-16 |
| `node scripts/e2e-ci.mjs` with Redis, S3, and SMTP (232 tests, `E2E_WORKERS=2`) | 130 to 143 s, of which Playwright 93 s; with one worker 200 s, of which Playwright 134 s | 2026-10-16 |
| The 12-module app's Playwright suite (214 tests) on a standing stack with `E2E_WORKERS` 1, 2, and 3 | 142, 90 to 93, and 81 s | 2026-10-16 |
| GitHub Actions: CI, e2e (median), Release | 1.1, 1.9, and 1.3 min | 2026-10-09 to 2026-10-16 |
| npm showing a published version in `npm view` | about 5 min after the Release workflow | 2026-10-09 to 2026-10-16 |

Changes made after a measurement:

- A script that set up and started a standing stack did not return for 10
  minutes (2026-10-15), although its servers answered within about 25 seconds.
  It started each server with `(cd apps/api && nohup bun src/main.ts > log 2>&1 &)`.
  Bash runs such a backgrounded list in a subshell that keeps the caller's
  standard output open while it waits for the server, so a caller that piped the
  output, as in `... | tail`, never saw its end. Redirecting the whole job, as in
  `(cd apps/api && exec bun src/main.ts) < /dev/null > log 2>&1 &`, and bounding
  each readiness probe with `curl -m` made the same start return after 1.2
  seconds (2026-10-16).
- A transient npm failure in the Outer install phase failed the whole run and
  cost a rerun of about 3 to 4 minutes (2026-10-16). The install now retries as
  described in [Tier 3](#tier-3-faithful-outer-gate). In a reproduction whose npm
  uplink dropped its first three requests, the install succeeded on its third
  attempt after 40 seconds; with Verdaccio's default five-minute `fail_timeout`,
  all three attempts failed (2026-10-16).
- The generated suite ran on one worker, because `--workers=2` failed tests that
  saw another worker's changes: three of 219 in the 12-module app and three of
  530 in a larger app (2026-10-16). An upload got `401` because public sign-up
  was closed, a user list came back empty because two-factor authentication was
  required, and a password-reset email disappeared when another test emptied
  Mailpit. Tests that change such state now carry the `@exclusive` tag
  and run after the others (see
  [Workers and exclusive tests](#workers-and-exclusive-tests)). Two workers took
  the standing suite from 142 to 90 and 93 seconds and the Outer Playwright
  phase from 134 to 93 seconds in two runs each, without a failure; the
  exclusive tests take about 40 seconds of either. Running the require-2fa test
  among the others again made an administrator request fail with `403`.
- With more than one worker a failing test left every exclusive test not run:
  36 of them in the 12-module app with one deliberately failing test
  (2026-10-17). `tests/run-e2e.ts` now runs them in a second Playwright run,
  which ran all 36 after the same failure. The second run seeds the accounts
  and cleans up again; the Outer full run with S3 and SMTP (241 tests,
  `E2E_WORKERS=2`) took 47.6 and 37.2 seconds for the two runs, 85.8 seconds of
  Playwright and 129 seconds in all (2026-10-17).
- Traces are now recorded for every test and kept for failed ones (see
  [Failed tests](#failed-tests)). The 12-module app's suite on its built web
  server (`E2E_WORKERS=2`, 192 and 39 tests in the two runs) took 96 seconds
  both with `trace: "retain-on-failure"` and with the earlier
  `"on-first-retry"` (2026-10-19). Against `vite dev` started cold, it took 128
  seconds.
- npm's delay is inherent. Poll it in the background, for example
  `until npm view @podosoft/podokit@<version> version; do sleep 30; done`.

## Playwright project extensions

Keep `tests/playwright.config.ts` managed. Add application-owned browser or
device projects in `tests/playwright.projects.cjs`:

```js
const { devices } = require("@playwright/test");

/** @type {NonNullable<import("@playwright/test").TestConfig["projects"]>} */
module.exports = [
  {
    name: "mobile-chromium",
    testMatch: /.*\.ui\.spec\.ts/,
    dependencies: ["setup"],
    use: {
      ...devices["Pixel 7"],
      storageState: "playwright/.auth/admin.json",
    },
  },
];
```

For an app without `admin-dashboard`, omit `dependencies` and
`storageState`. Project names must be non-empty and unique, including the
`<name>-exclusive` twin that each project gets (see
[Workers and exclusive tests](#workers-and-exclusive-tests)).

The admin setup project seeds sessions through the API and stores ignored browser
state under `tests/playwright/.auth`. Its cleanup project removes users created
by the suite.

## Application screens and accounts

The managed specs test PodoKit's own components, such as the account page, the
admin console, and the site footer. Where they have to visit an application
page or sign in as a seeded account, they read it from two application-owned
files that PodoKit creates once and never overwrites, so an application changes
those files instead of editing or ejecting managed specs.

`tests/helpers/app-paths.ts` overrides the screens described in the managed
`tests/helpers/paths.ts`:

| Entry | Default | Used by |
| --- | --- | --- |
| `home` | `/` | the smoke test and maintenance mode |
| `homeReady(page)` | the page's `h1` | the smoke test and the sidebar's home link |
| `indexable` | `["/"]` | public pages that must not carry `X-Robots-Tag` |
| `footer` | `/login` | a public page that renders `SiteFooter` (`data-testid="site-footer"`); `null` skips the footer test |
| `accountMenu` | `/` | a page that renders `LanguageSwitch`, `ThemeToggle`, and `AccountMenu`; the account menu tests use it, and `null` skips them |
| `themeToggle` | `accountMenu`, or `/admin` when that is `null` | a page that renders `ThemeToggle` (`data-testid="theme-toggle"`) for the signed-in administrator; the theme test uses it, and `null` skips it |

```ts
import type { AppPaths } from "./paths";

export const appPaths: Partial<AppPaths> = {
  homeReady: (page) => page.getByTestId("workspace"),
  indexable: [],
  footer: null,
};
```

With `admin-dashboard`, `tests/helpers/app-accounts.ts` names the seeded
accounts when an application's differ from `admin@example.com` and
`user@example.com`. `E2E_ADMIN_EMAIL`, `E2E_USER_EMAIL`, `E2E_ADMIN_PASSWORD`,
and `E2E_USER_PASSWORD` win over it. The seed signs the user up but only signs
the administrator in, because the API refuses a sign-up with an `ADMIN_EMAILS`
address. Create the administrator first: for the default accounts, run
`ADMIN_BOOTSTRAP_EMAIL=admin@example.com ADMIN_BOOTSTRAP_PASSWORD='Podokit3e-Str0ng!pw' ADMIN_BOOTSTRAP_NAME=Admin bun run --cwd apps/api admin:bootstrap`
with `admin@example.com` in `ADMIN_EMAILS`, as `scripts/e2e-ci.mjs` does after the
migrations. Set `E2E_UNCLAIMED_ADMIN_EMAIL` to an `ADMIN_EMAILS` address without an
account to run the test that a sign-up cannot claim it. Specs of modules that do
not require `admin-dashboard`, such as the object storage and SSE specs, sign
in as the administrator through `tests/helpers/seeded-admin.ts`, which reads the
same values and skips those tests in an app without that module.

## Sign-in budget

Sign-ins and sign-ups from an anonymous client count against the per-address
authentication budget of the `rate-limit` module, which every spec shares. The
specs that need many sessions or several new accounts make only their first
authentication write anonymously and send the rest with that session's cookie,
which the limiter counts against the session. A spec of your own that signs in
in a loop can call `signInOnSeparateDevices` from `tests/helpers/devices.ts`.

## CI policy

Fast CI runs package tests, type checks, and a Bun-generated application gate.
The gate also starts the built API and web server for about a second and checks
that a `POST` without a body or `Origin` header reaches the API through `/api`
while a cross-site form `POST` gets `403`, because the Vite dev server does not
make that check (see the
[cross-site form check](templates.md#cross-site-form-check)). Ready pull
requests run Outer smoke; nightly and manual workflows run the full matrix. New
pushes cancel superseded workflow runs.

A changeset version PR uses package-smoke because the source feature PR already
ran browser behavior. A release is not approved by tests alone: package
publication, tags, and GitHub Releases remain explicit maintainer actions.
