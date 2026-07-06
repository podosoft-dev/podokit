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
| Who | PodoKit maintainer | CI + pre-commit gate | End developer (after `podo create`) |
| When | While building a module/template | Before commit/release; nightly | After they install |
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

> Rule (also in CLAUDE.md): author and iterate in (A); the final check before
> commit/release is always (B). Do not mix the two.

## Running the tests (C — and the shape of A/B)

_Filled in as the test scaffolding lands._ The generated app will expose:

```bash
npm run test:e2e         # all specs (ui + api projects)
npm run test:e2e:ui      # browser (Playwright chromium) — the pages
npm run test:e2e:api     # request-only — backend endpoints
npm run test:e2e:report  # open the HTML report
```

Prerequisites: PostgreSQL running and the auth tables migrated
(`npx @better-auth/cli migrate -y --config apps/api/src/auth/auth.ts`), the API on
`:3000` and the web on `:5173`. See [development.md](./development.md) for the local
harness (`dev-app.mjs`, `dev-watch.mjs`).

## (A) Authoring loop — maintainers

_Filled in as Phase 1–2 land._ Outline: run the live app with `dev-watch`
(web HMR + `nest start --watch`), explore with `@playwright/cli` / Test Agents to
produce `specs/*.md`, generate `tests/*.spec.ts`, and re-run `npx playwright test`
against the linked app until stable.

## (B) Faithful verification — Verdaccio + npx create

_Filled in as Phase 3 lands._ Outline: `scripts/e2e-ci.mjs` starts Verdaccio, publishes
the three packages to it, runs the real `npx --registry=<verdaccio> @podosoft/podokit
create` + `podo add`, migrates, and runs the shipped `test:e2e`. This is also the CI
job (`.github/workflows/e2e.yml`): PostgreSQL service, browser cache, artifacts;
triggered nightly + on demand + PR smoke (`--grep @smoke`).
