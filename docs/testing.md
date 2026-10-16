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
worker. With one worker the twins come last; with more, each twin depends on
every other test project and on the twin before it, so an exclusive test never
runs alongside another test. Projects that applications add in
`tests/playwright.projects.cjs` get twins as well, except setup projects that
another project depends on. Tests never empty the shared inbox or sink; each
one mails and texts recipients of its own.

Playwright runs a project's dependencies in full. With more than one worker, a
run that selects exclusive tests with a file name, `--grep`, or `--project`
therefore runs every other test first, and a test that fails there marks the
exclusive tests as not run. Use more workers for the whole suite and the default
single worker for a few files. The global setup refuses `--workers` above 1
without `E2E_WORKERS`, because the projects are already built by then; do not
combine `--no-deps` with `E2E_WORKERS` above 1 either.

Install the browser once from the generated project with:

```bash
bunx playwright install chromium
```

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
- The full suite runs with `E2E_WORKERS=2`; smoke and `--grep` runs keep one
  worker, because with more a selected exclusive test pulls in every other
  test. Set `E2E_WORKERS` to override either.

The harness publishes the template engine, contracts, auth helpers, API client,
CLI, MCP server, and external modules to Verdaccio. It then uses the real CLI,
installs the generated workspace with Bun 1.4.0, runs Better Auth and TypeORM
migrations, verifies the OpenAPI contract, builds and starts the Bun API and
worker plus the SvelteKit server, and runs the shipped Playwright suite.

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
configures those services. When `S3_ENDPOINT` is configured, storage failures fail
the smoke test, and the storage and chunked upload specs also download their
objects through the presigned URL. Without it, they skip that download, because a
containerized dev stack signs URLs for an in-network host that the runner cannot
resolve. Local storage returns a signed API path, which is always downloaded.
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

## CI policy

Fast CI runs package tests, type checks, and a Bun-generated application gate.
Ready pull requests run Outer smoke; nightly and manual workflows run the full
matrix. New pushes cancel superseded workflow runs.

A changeset version PR uses package-smoke because the source feature PR already
ran browser behavior. A release is not approved by tests alone: package
publication, tags, and GitHub Releases remain explicit maintainer actions.
