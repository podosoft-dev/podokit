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

Use a real migration for the selected database and real Redis/MinIO services for
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

The harness publishes the template engine, contracts, auth helpers, API client,
CLI, MCP server, and external modules to Verdaccio. It then uses the real CLI,
installs the generated workspace with Bun 1.4.0, runs Better Auth and TypeORM
migrations, verifies the OpenAPI contract, builds and starts the Bun API and
worker plus the SvelteKit server, and runs the shipped Playwright suite.

Optional Mailpit, SMS, Redis, and MinIO tests run only when the harness explicitly
configures those services. `KEEP=1` preserves the generated app for inspection.
Ports and backing-service credentials can be overridden with the documented
`E2E_*`, `POSTGRES_*`, Redis, and S3 environment variables. The shared suite's
general request ceiling defaults to 1000; override it with
`E2E_RATE_LIMIT_MAX` when extending or diagnosing the matrix. The rate-limit
spec uses that same value so it still verifies a real 200-to-429 transition.

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
`storageState`. Project names must be non-empty and unique.

The admin setup project seeds sessions through the API and stores ignored browser
state under `tests/playwright/.auth`. Its cleanup project removes users created
by the suite. Tests share mutable backing services, so keep one worker unless the
data and settings are explicitly isolated.

## CI policy

Fast CI runs package tests, type checks, and a Bun-generated application gate.
Ready pull requests run Outer smoke; nightly and manual workflows run the full
matrix. New pushes cancel superseded workflow runs.

A changeset version PR uses package-smoke because the source feature PR already
ran browser behavior. A release is not approved by tests alone: package
publication, tags, and GitHub Releases remain explicit maintainer actions.
