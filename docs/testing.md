# Testing

PodoKit apps are produced by the `podo` CLI, so what we verify is the **generated
output**, and the e2e/ui tests ship **inside** the generated app (`tests/` workspace)
so developers can run them after `podo create`. This guide separates the three
contexts in which those same tests run — do not mix them.

## Two tools (author vs run)

Playwright gives you two complementary tools; use the right one per phase
([Playwright Test Agents](https://playwright.dev/docs/test-agents),
[auth](https://playwright.dev/docs/auth)):

- **`@playwright/cli` + Test Agents** — for AI-driven **authoring**. `npx playwright
  init-agents --loop=claude` installs a **planner** (explores the app → `specs/*.md`
  plans), a **generator** (turns a plan into `@playwright/test` specs, verifying
  selectors live), and a **healer** (repairs failing specs). Conversational and
  token-efficient — the fast, AI-friendly way to explore a UI and produce specs.
- **`@playwright/test`** — for **running**. `npx playwright test` executes the
  generated `*.spec.ts` deterministically. This is what developers and CI always run.

Loop: explore with the CLI → codify into specs → CI runs the specs → the healer/CLI
repairs them when they break.

## Three contexts (Inner / Outer / Shipped) — keep them separate

The spec files have a single source of truth (the module/template source), but they
run in three different environments. Confusing these causes development-vs-release
mistakes, so each is named explicitly.

| | (A) Inner — internal dev | (B) Outer — faithful gate | (C) Shipped — developer |
| --- | --- | --- | --- |
| Who | PodoKit maintainer | CI + merge/release gate | End developer (after `podo create`) |
| When | While building a module/template | Ready PRs, release packaging, nightly | After they install |
| App source | local `file:`-linked, via `dev-app.mjs` | real `npx create` from **Verdaccio** | real `npx create` from **npm** |
| Speed loop | `dev-watch` live mirror + `@playwright/cli` | full generate → migrate → run | n/a (they run it) |
| Runs | `npm run test:e2e` in the linked app | `npm run test:e2e` in the generated app | `npm run test:e2e` |

- **(A) Inner loop** is for *speed while authoring*. It uses the unpublished packages
  via a `file:` link and `dev-watch` to reflect edits live. Never treat (A) as release
  verification.
- **(B) Outer loop** is the *faithfulness gate*: it publishes the packages to a local
  Verdaccio registry and runs the exact `npx @podosoft/podokit create` a user runs, so
  the install/generate path is validated (no `file:` shortcuts). This is what proves
  the (C) experience.
- **(C) Shipped** is simply the `tests/` workspace that lands in a user's app; running
  it is `npm run test:e2e`. (B) guarantees it works.

> Rule (also in CLAUDE.md): author and iterate in (A); use the appropriate (B)
> mode before merge/release. Do not run the full Outer loop after every local edit.

## Running the tests (C — and the shape of A/B)

Every generated app exposes:

```bash
npm run test:e2e         # all specs (ui + api projects)
npm run test:e2e:ui      # browser (Playwright chromium) — the pages
npm run test:e2e:api     # request-only — backend endpoints
npm run test:e2e:report  # open the HTML report
```

The suite runs against a **live stack**: the web on `E2E_BASE_URL` proxying
`/api/*` to the API. With the recommended containerized loop, bring the app up
through its generated hostname and pass that origin to Playwright:

```bash
npx @podosoft/podokit dev watch
# then, in another shell:
E2E_BASE_URL=http://my-app.localhost npm run test:e2e
```

The default `http://localhost:5001` remains convenient for the alternative
host-process loop:

```bash
docker compose -f infra/docker/docker-compose.yml up -d postgres
npx @better-auth/cli migrate -y --config apps/api/src/auth/auth.ts   # if using auth/admin-dashboard
npm run dev            # api on :5002, web on :5001
# then, in another shell:
npm run test:e2e
```

The first run installs the Playwright browser: `npx playwright install chromium`
(run inside `tests/`). Specs ending in `*.api.spec.ts` run in the request-only `api`
project; `*.ui.spec.ts` run in the chromium `ui` project. When the app has the
admin-dashboard module, a `setup` project seeds admin + user sessions via the API and
saves `storageState` the other projects reuse. See [development.md](./development.md)
for the local harness (`dev-app.mjs`, `dev-watch.mjs`).

## (A) Authoring loop — maintainers

Author specs against a live, `file:`-linked app so edits reflect instantly:

1. Generate + link: `node scripts/dev-app.mjs /tmp/app --add admin-dashboard`, bring up
   Postgres, migrate, and run the app in watch mode (`node scripts/dev-watch.mjs` +
   `nest start --watch` + `vite dev`).
2. Explore with `@playwright/cli` / Test Agents (`npx playwright init-agents
   --loop=claude`): the planner writes `specs/*.md`, the generator turns them into
   `tests/*.spec.ts` while checking selectors live, the healer repairs breakage.
3. Iterate `npx playwright test` in the linked app until green.

Notes learned the hard way: seed sessions via the **API** (not the login UI) to avoid
dev-server hydration races; SvelteKit `Card.Title` renders a `<div>`, not a heading, so
assert on stable roles (buttons, inputs, `<main>`-scoped text); keep the suite
`workers: 1` when it shares one database. This is the fast loop — **never** the release
check.

## (B) Faithful verification — Verdaccio + npx create

`scripts/e2e-ci.mjs` reproduces exactly what a user runs:

```bash
node scripts/e2e-ci.mjs                         # full suite
node scripts/e2e-ci.mjs --smoke                 # risk-based @smoke subset for ready PRs
node scripts/e2e-ci.mjs --package-smoke         # publish/install/build/start, no browser suite
node scripts/e2e-ci.mjs --grep "magic link"     # only matching specs (fast feedback on one feature)
```

The package-smoke mode is the Changesets version-PR gate. Version and internal
dependency range changes still travel through the real local registry, generated
app installation, migrations, builds, and health checks, but do not repeat feature
browser scenarios that already ran on the source PR.

Optional service-backed specs run only when their corresponding runtime is
explicitly configured. In particular, an unrelated Mailpit already listening on
port 8025 is ignored unless `SMTP_HOST` is also set, so local Outer runs cannot
read mail from a sink the generated API is not using.

### Three-tier verification — how maintainers iterate fast

The Outer run is dominated by **publish → `npx create` → `npm install` → build API + web**
(minutes), not the Playwright run (seconds). So narrowing the tests (`--grep`) barely
shortens a run — it mainly sharpens the signal. Split verification into three tiers:

| Tier | When | What | Cost |
|---|---|---|---|
| 1 | every edit | `svelte-check` on the standing app's web; `nest build` on a regenerated app when injection targets changed | seconds |
| 2 | before each feature commit | run just that feature's spec against the **standing verification app**: `E2E_BASE_URL=http://localhost:<web-port> npx playwright test <spec>` | seconds–1 min |
| 3 | once when a PR is ready for review | the Outer smoke: `node scripts/e2e-ci.mjs --smoke` (one feature only: `--grep "<pattern>"`) | minutes |

Standing verification app rules:

- Generate it once (`dev-app.mjs` + `dev-watch` + `vite dev`/`nest start --watch`) and keep
  it running. Template edits to non-injected files mirror instantly.
- Injection-target changes (`auth.ts`, `app.module.ts`, manifest `inject`) don't mirror —
  **regenerate that one app** when you change them (see development.md). Don't re-run the
  full Outer on every tweak; it's the per-batch gate, and CI repeats it once per PR.

It starts Verdaccio (`scripts/verdaccio.yaml`), publishes the three packages
(template-engine, api-client, cli) to it, runs the real `npx @podosoft/podokit create`
+ `podo add admin-dashboard`, `npm install`s **resolving `@podosoft/*` from the
registry** (no `file:` shortcut), writes `.env`, migrates, builds + starts the API and
web, and runs the shipped `test:e2e`. Ports and Postgres are env-configurable
(`REGISTRY_PORT`, `API_PORT`, `WEB_PORT`, `OUTAGE_WEB_PORT`, `POSTGRES_*`). Before
starting the API, it also boots the generated web app against an unreachable backend
and verifies that public `/` still renders, protected `/admin` returns 503 without a
redirect, and no session cookie is modified. `KEEP=1` preserves the app for inspection.

This is the CI job [`.github/workflows/e2e.yml`](../.github/workflows/e2e.yml):
PostgreSQL service with a health check, generated-app npm and Playwright browser
caches, report + trace artifacts (`if: always()`). The full suite runs nightly and
on demand. Draft and irrelevant PRs keep a successful skipped e2e job, ready PRs
run the reviewed `@smoke` subset, and the generated Changesets PR runs
`--package-smoke`. Job-level gating keeps required-check behavior predictable;
`concurrency` cancels superseded runs. Every Outer run prints per-phase timings so
future optimization is based on measured publish, install, build, startup, and test
costs.

The ready-PR subset intentionally stays small and risk-based. It covers scaffold
health, authentication and authorization boundaries, one representative path for
each backing-service module, critical admin settings, and recent regressions. The
complete feature matrix remains in the nightly suite. The tests currently share a
single backend and database, so the admin overlay deliberately keeps one worker;
do not add sharding until test data and mutable settings are isolated. Running the
whole Outer setup once per shard would duplicate its dominant setup cost.

## CI feedback policy

- Push small commits freely. The fast CI workflow is the normal feedback loop.
- Open work-in-progress changes as draft PRs; expensive e2e begins when the PR is
  marked ready for review.
- New commits cancel obsolete runs for the same workflow and ref.
- Keep the latest ready-PR smoke green before merge.
- Keep the full fresh-install and Playwright matrix in nightly/manual verification.
- Validate generated version changes with package-smoke before publishing.
