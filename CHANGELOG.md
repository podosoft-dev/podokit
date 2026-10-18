# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- The generated theme spec, `tests/ui/theme-mode.ui.spec.ts`, skipped in apps
  whose `tests/helpers/app-paths.ts` sets `accountMenu` to `null`, so it checked
  nothing there even when the app renders the theme toggle on another page. It
  now opens the new `themeToggle` entry, which defaults to `accountMenu` and,
  when that is `null`, to `/admin`, whose header renders the managed toggle for
  the signed-in administrator. Set `themeToggle` to a page of the app's own, or
  to `null` to skip the test.
- An organization's `list-members` answered 500 on PostgreSQL when a filter or
  an offset matched no member: Better Auth's Kysely adapter sends an `in` filter
  on an empty array as `IN ()`, which PostgreSQL rejects. The `auth` module now
  runs Better Auth's PostgreSQL queries through a Kysely instance with a plugin
  that sends an empty `in` list as `1 = 0` and an empty `not in` list as
  `1 = 1`, and the generated API depends on `kysely` directly. SQLite accepts
  `IN ()` and is unchanged.
- The `rate-limit` module's spec, `tests/api/rate-limit.api.spec.ts`, expected
  the limits from the runner's environment and otherwise the module defaults,
  so it failed against a stack with other limits, such as the development
  example's `RATE_LIMIT_MAX=100` or raised local limits, unless the runner was
  given the same values. It now reads each budget's limit from the API's
  `RateLimit-Limit` header and checks which budget a route is counted in from
  how `RateLimit-Remaining` moves. Limits set in the runner's environment are
  still expected exactly. A check that compares counts across requests runs
  again when a short `RATE_LIMIT_TTL` window ends in between, the 429 test
  skips when the general window ends before this client reaches the limit, and
  the session read test skips when the authentication limit is not below the
  runtime one. It probes `/api/account/me` instead of the Redis provider's demo
  cache route. `E2E_SKIP_RATE_LIMIT=true` still skips the file.
- The `audit-log` module records every sign-in as `auth.login`. Only
  `/sign-in/email` was recorded, so social, magic link, email code, passkey,
  phone number, username, and two-factor sign-ins, and the automatic sign-in
  after email verification, left no entry. Each entry names the method in
  `metadata.method` and, for social sign-in, the provider in
  `metadata.provider`.
- The `audit-log` module no longer records failed requests as completed
  actions. Better Auth runs after hooks for failed requests too, so a wrong
  password was recorded as `auth.login`, a non-administrator's refused
  `/admin/ban-user` as `user.ban`, and a failed password change as
  `auth.password_change`. The password step of a two-factor sign-in was also
  recorded as a sign-in, and the second factor that completes it was not; the
  sign-in is now recorded once, when the second factor completes it.
- The audit hook is now a Better Auth plugin that `apps/api/src/auth/auth.ts`
  pushes after every other plugin, because the top-level `hooks.after` it used
  runs before the two-factor plugin's hook. `podo update` replaces the
  `hooks.after = auditAfterHook;` line and its import. An application that owns
  `auth.ts` replaces them with `plugins.push(auditPlugin());` and
  `import { auditPlugin } from "../audit/audit-hook";`.
- `podo deploy status` on Kubernetes reports the restarts of each Deployment's
  current revision only. It added up the restarts of every pod with the
  workload's label, so right after `podo deploy apply` or `rollback` it reported
  the restarts of replaced pods that were still terminating as if the new
  release had restarted. `restartCount` now counts the running pods of the
  ReplicaSet that carries the Deployment's revision, and the new `previousPods`
  field gives the `count` and `restartCount` of the other pods, from an earlier
  revision or terminating. A pod or ReplicaSet list of an unexpected shape fails
  the command.
- `podo update --apply` 3-way merges edited managed files without `--from`.
  Without it, every edited managed file was left as it was and reported as a
  conflict while the manifest and lock moved to the new version, so that
  version's changes to those files were never applied. The merge base is now the
  templates of the version `.podokit/manifest.json` records: the installed CLI's
  own when the project is on that version, and otherwise that version of
  `@podosoft/podokit`, installed from the npm registry into a temporary
  directory. When the registry cannot provide it, `--apply` stops before writing
  anything and lists the files that need the merge; `--from <dir>` still takes
  precedence. Edited files without a merge base, such as one the new version
  removes, are listed as skipped with the reason.
- Rolling updates on Kubernetes no longer answer requests with 502 while a
  replaced API or web pod leaves. A terminating pod still receives new
  connections until the nodes and the ingress controller drop it from its
  Service's endpoints, but the servers stop accepting connections on `SIGTERM`.
  The rendered API and web containers now run `sleep 5` in a `preStop` hook
  before `SIGTERM`, and their pods' `terminationGracePeriodSeconds` covers the
  hook, the web server's `SHUTDOWN_TIMEOUT` drain (30 seconds unless
  `runtimeConfig` sets it), and 5 seconds to exit: 40 seconds by default instead
  of 30.
- The generated `podokit-deploy` agent skill reports the `previousPods` of
  `podo deploy status` apart from the current revision's `restartCount` instead
  of "restart totals", so an agent no longer attributes the restarts of pods
  replaced by `apply` or `rollback` to the new release.

## [1.6.1] - 2026-10-17

### Fixed

- The generated API contract check, `bun run contract`, expects the routes of a
  provider module only while `PROVIDERS` selects its provider, including a
  `<CAPABILITY>_PROVIDER` override. An app with both object-storage modules
  installed and S3 selected failed on `GET /files/content/*`, and one that
  selected the memory cache with `redis` installed failed on the `/cache`
  routes. The check also covers the `jobs-local` routes.
- Deployment profiles count application PostgreSQL pools of a fixed size:
  an entry in `dependencies.postgres.appPools` takes `size` instead of
  `sizeKey` when the application's code sets the pool's size, such as a
  TypeORM data source with the `pg` default of 10. `appPools` accepted only a
  `sizeKey`, so such a pool was refused as an unknown key or left out, and
  `podo deploy doctor` and `podo deploy plan` under-counted the connections a
  deployment can open. Each entry sets exactly one of `sizeKey` and `size`.
- `JobQueue.schedule()` no longer keeps every finished run. A schedule added
  its jobs without removal options, so BullMQ kept each completed and failed
  run in Redis (86,400 a day for a schedule every second) and the local
  provider kept the same rows in `podokit_job`. When a scheduled run finishes,
  both providers now keep the newest 100 completed and 1000 failed jobs of its
  name, jobs added with `enqueue()` included, and remove older ones. An
  optional fifth argument, `ScheduleOptions`, sets `keepCompleted` and
  `keepFailed`; 0 removes only the finished run, and a negative or fractional
  limit rejects. `@podosoft/podokit-runtime` exports `ScheduleOptions`,
  `scheduleRetention()`, and the default limits.
- The generated admin navigation unit test, `apps/web/src/lib/admin/nav.test.ts`,
  failed in apps whose modules add admin pages, such as `blog` and `analytics`,
  because its expected list left out their entries. It now stands in for the
  module entries as it does for the application's and checks that they follow
  the application's entries and come before Settings. The CI gate's generated
  app installs `blog` and `analytics`, which `scripts/dev-app.mjs` now adds from
  the local packages.
- The generated theme spec, `tests/ui/theme-mode.ui.spec.ts`, failed on every
  run against a development server: after reloading the page it opened the
  theme menu before the page had hydrated, so the click did nothing. It now
  waits with the new `hydrated(page)` from `tests/helpers/hydration.ts`, finds
  the toggle by its new `data-testid="theme-toggle"`, and opens the
  `accountMenu` page from `tests/helpers/app-paths.ts`, so it also works with
  an application's own header.
- The generated API build test, `apps/api/src/build.spec.ts`, copied the
  application's `scripts/build.extensions.mjs` into its temporary builds, so
  four of its tests failed as soon as an application listed a build target of
  its own. Each build now starts without application targets, and the tests
  of `appBuildTargets` pass their own file. The CI gate's generated app lists
  an API build target of its own and runs the built entry point.
- A failing test no longer keeps the tests tagged `@exclusive` from running.
  With `E2E_WORKERS` above 1 their twin projects depended on every other test
  project, and Playwright skips a project whose dependency failed, so one
  failure left about 40 exclusive tests not run. The `test:e2e` scripts now
  start the suite through the new `tests/run-e2e.ts`: it runs the other tests
  first and the exclusive ones in a second Playwright run on one worker, even
  after a failure, and fails when either run fails. The second run writes its
  results and HTML report to `exclusive/` subfolders. A filter applies to both
  runs, so selecting an exclusive test no longer runs every other test first.
  A single `bunx playwright test` on more workers keeps the old ordering and
  warns about it. The Outer harness runs the suite through `run-e2e.ts`.
- The `object-storage-s3`, `object-storage-local`, and `sse` specs signed in as
  `admin@example.com` with the default password, or the `E2E_ADMIN_*`
  variables, and ignored the application's `tests/helpers/app-accounts.ts`.
  They now sign in through the new `tests/helpers/seeded-admin.ts`, which
  reads the same values as `accounts.ts` and returns null in an app without
  `admin-dashboard`, where those tests skip. The check that managed specs name
  seeded accounts only through the account helpers also catches `E2E_*`
  account variables and covers the external module packages.

## [1.6.0] - 2026-10-17

### Added

- Generated e2e suites read the application's own screens from the owned
  `tests/helpers/app-paths.ts` (first screen and its locator, indexable public
  pages, the page with the site footer, the page with the account menu) and,
  with `admin-dashboard`, its seeded accounts from the owned
  `tests/helpers/app-accounts.ts`, with `E2E_ADMIN_EMAIL` and `E2E_USER_EMAIL`
  overrides. Managed specs no longer assume a `main` element and an `h1` on
  `/`, an indexable landing page, the footer on the owned `/login`, or the
  `admin@example.com` and `user@example.com` addresses, so an application
  sets these instead of ejecting the specs. `SiteFooter` carries
  `data-testid="site-footer"`.
- Deployment profiles take `exposure.edgeProxies`, the number of reverse
  proxies in front of the deployment (new Kubernetes profiles 0, new Compose
  profiles 1), and PodoKit renders from it every setting that decides which
  forwarded headers web and API trust: `XFF_DEPTH` is `edgeProxies` + 1 behind a
  Kubernetes Ingress, `edgeProxies` for a NodePort or a directly published
  Compose web service, and 1 behind the Compose gateway; `ADDRESS_HEADER`,
  `PROTOCOL_HEADER`, and `HOST_HEADER` are set only behind a proxy; and the API
  always trusts one hop. `podo deploy doctor` warns when `edgeProxies`,
  `trustedProxyCidrs`, and direct paths contradict each other, including a
  Kubernetes Ingress behind an edge proxy with WebSocket or direct API paths,
  where the API records the edge proxy for those requests.
- `podo deploy doctor` and `podo deploy plan` count the PostgreSQL connections a
  deployment can open: every API and worker process with `DB_POOL_MAX` + 1 and,
  with `auth`, `DB_AUTH_POOL_MAX`, one surge pod per workload during a
  Kubernetes rollout, and the migration. The doctor fails when the processes
  alone exceed `max_connections` minus the 3 reserved connections, and both warn
  when a deployment can. `dependencies.postgres.maxConnections` (default 100)
  states the server's limit and is rendered as `-c max_connections` for a
  PostgreSQL server PodoKit runs, and `dependencies.postgres.appPools` lists the
  application's own pools by the `runtimeConfig` key that caps them. The
  Kubernetes `plan` prints its warnings too.
- `podo deploy doctor` checks the profile against the application before it
  contacts the target, and reports a setting that deploys but probably not as
  intended as a `warn` line, which does not stop `podo deploy apply`. With the
  `audit-log` module installed it warns when `runtimeConfig` lacks
  `AUDIT_LOG_ENABLED` or sets it to anything but `"true"`. JSON findings carry
  `"warning": true`.
- `podo diff <path...>` prints a unified diff from the template's version of each
  file to the working copy, for managed and owned files alike, and says when a
  file matches, is missing, or is not generated by PodoKit. Without paths it
  still lists the edited managed files.
- `podo restore <path...>` rewrites managed files from the template and records
  them as clean in `.podokit/files.lock`. It also undoes `podo eject`: an ejected
  file is rewritten, leaves the manifest's owned paths, and is managed by
  updates again. It refuses routes and other files the template or a module
  declares owned, and a project on another PodoKit version than the CLI.
- `podo update` lists owned files whose template changed since PodoKit last
  rendered them as `review`, without writing them, such as a corrected
  `.mcp.json`, `.devcontainer/devcontainer.json`, or route page. With `--from
  <previous templates>` the dry run prints what changed upstream. The lock
  records the template of each owned file at create, eject, and update; for a
  lock written before, the plan counts the owned files that differ from the new
  templates, and applying the update starts the record.
- Generated apps run their Playwright suite on more than one worker with
  `E2E_WORKERS` (default 1), for example `E2E_WORKERS=2 bun run test:e2e`. A
  test that changes state the other tests rely on carries the `@exclusive` tag:
  every project gets an `<name>-exclusive` twin that runs only tagged tests on
  one worker, and with more than one worker the twins run after every other
  test, one after another. The managed specs that change feature flags, the
  authentication configuration, the site settings, module settings, or the
  seeded administrator's profile carry the tag, and projects from
  `tests/playwright.projects.cjs` get twins too. `test:e2e:api` and
  `test:e2e:ui` include the twins. The global setup refuses `--workers` above 1
  unless `E2E_WORKERS` is set, because the twins are ordered only through it.
  In a 12-module app the suite took 142 seconds on one worker, 90 and 93 on two,
  and 81 on three (2026-10-16); before, two workers failed tests that saw
  another worker's settings.
- Application-owned extension points in the web app, so applications no longer
  edit managed files for these changes. `apps/web/vite.extensions.ts` exports
  `appViteConfig`, which the managed `vite.config.ts` merges with Vite's
  `mergeConfig` (warmup, `optimizeDeps`, `define`, plugins, allowed hosts), and
  `appSvelteKitConfig`, which it passes to `sveltekit()` (`alias`, `csrf`). With
  `admin-dashboard`, `appHandle` in `apps/web/src/lib/server/app-hooks.ts` runs
  for every request after `hooks.server.ts` loads the site settings, the
  session, and the locale, so it can adjust `event.locals` or the response;
  `APP_ADMIN_NAV` in `apps/web/src/lib/admin/app-nav.ts` adds admin sidebar
  entries before module entries and Settings; and `APP_NON_INDEXABLE_PATHS` in
  `apps/web/src/lib/server/non-indexable-paths.ts` adds prefixes that answer
  with `X-Robots-Tag: noindex, nofollow`. `podo update` creates each file once
  in an existing app and never overwrites it. See
  [web extension points](docs/templates.md#web-extension-points).
- `bun run dev` proxies the exact `webSocketPaths` of `.podokit/dev.json`, with
  or without a query string, from the Vite dev server to `BACKEND_INTERNAL_URL`.
  A WebSocket endpoint on the API now works in host development the way it does
  behind the `podo dev` gateway and a deployment's edge.
- The `/api` proxy and the server-side API client tell the API which public
  origin a request came in on, in `x-forwarded-host` and `x-forwarded-proto`.
  The values come from the request URL SvelteKit resolved and are sent only when
  `CORS_ORIGIN` lists that origin; a caller's own forwarded headers are still
  dropped. An API route that builds links for the browser can pick the origin a
  visitor used among its configured origins.
- `tests/ui/same-origin-requests.ui.spec.ts` (admin-dashboard) sends a
  `FormData` upload, a form-encoded body, and `POST` and `DELETE` requests
  without a body from the browser through the `/api` proxy, and checks that each
  carries the page's `Origin` and reaches the API. It passes on the built web
  server, where SvelteKit checks the origin, and through the `podo dev` gateway.
  When a deployment answers such requests with 403 "Cross-site POST form
  submissions are forbidden", the web server resolved another origin than the
  browser; see
  [the deployment guide](docs/deployment.md#uploads-answer-403-cross-site-post-form-submissions-are-forbidden).
- `DataTableColumn` takes a `head` snippet that replaces the column's label and
  sort button in the header, for example a select-all checkbox. Give the
  control its own accessible name.
- `<html>` carries the `light` class in light mode as it carries `dark` in dark
  mode, from the first paint. Component libraries that follow a `.dark` or
  `.light` class and fall back to the system setting without one now match the
  theme the visitor chose instead of painting their dark palette on a light page
  when the system is dark.
- `sidebar-user-menu.svelte` works outside a `Sidebar.Provider`. There it
  renders the `AccountMenu` identity block (avatar, name, email, account and
  sign-out actions) instead of failing on the missing sidebar state, so an
  application's own shell can place it without a copy of its own.
- `apps/web/src/app.extensions.css` is an application-owned stylesheet that the
  managed `app.css` imports last, so its rules follow PodoKit's theme variables
  and base styles. Override `:root` and `.dark` variables, add `@theme` entries,
  fonts, and base styles, or add `@source` for a package whose built components
  use Tailwind classes. `podo update` creates it once and never overwrites it.
- The name users see during sign-in follows the app instead of the libraries.
  Authenticator apps showed the TOTP issuer "Better Auth" and browsers showed
  "PodoKit" in the passkey prompt. One name now feeds Better Auth's `appName`,
  the TOTP issuer, and the passkey relying-party name: `AUTH_APP_NAME` when set,
  otherwise the site name from the admin Settings, otherwise the project name
  the app was generated with. A site name change applies without a restart.
  `@podosoft/podokit-auth` resolves it as `AuthConfig.appName`, with the
  `appNameSetting` and `defaults.appName` options of `createConfigStore()`.
- `bun run --cwd apps/api migrate:list` prints the name of every migration the
  current build would run, without a database; in an image,
  `docker run --rm <api-image> bun run migrate:list`.
- The API listens on `HOST` (default `0.0.0.0`), and `SQLITE_PATH` sets the
  SQLite file when `DATABASE_URL` is unset (default `./data/podokit.sqlite`), so
  an app that binds to loopback or keeps its database elsewhere, such as a
  desktop shell, no longer edits `main.ts` or `database.ts`.
- `apps/api/src/config/env.extensions.ts` is an application-owned extension of
  the validated API environment. Its `appEnvShape` fields are validated with
  PodoKit's at startup and typed on `AppEnv`, and `refineAppEnv(env, context)`
  adds checks across variables, such as one production requires. Redefining a
  PodoKit variable fails at startup. `podo update` creates the file once in
  existing apps and never overwrites it.
- `apps/api/src/database/entities.ts` is an application-owned list of TypeORM
  entities, `APP_ENTITIES`, that the migration data source loads, and the API's
  `tsconfig.json` enables `experimentalDecorators` and `emitDecoratorMetadata`
  for them. `podo update` creates the file once and never overwrites it.
- `AppException` takes optional `details` as its fourth argument, and the API
  returns them as `error.details` in the error envelope, for example the fields
  a request failed on: `throw new AppException("SIGNUP_INVALID", "Invalid
  sign-up", 422, { fields })`. Apps no longer subclass it or edit `app.ts`.
- `apps/api/src/core/api-contract.extensions.ts` is an application-owned list,
  `APP_DOCUMENTED_ROUTES`, of the operations the app's own API must serve, such
  as `"GET /reports/{id}"` (`:id` works too). `bun run contract` fails when one
  is not registered or missing from the OpenAPI document. `podo update` creates
  the file once and never overwrites it.
- The auth module's `apps/api/src/settings/app-flags.ts` is an
  application-owned list of on/off settings with their defaults,
  `APP_FLAG_DEFAULTS`. They are stored with the feature flags, changed with
  `PUT /account/settings`, read with `SettingsService.getBool()`, and returned
  as `appFlags` by `GET /account/capabilities` (`Capabilities.appFlags` in
  `@podosoft/podokit-contracts`). A missing row keeps the default, and a name
  PodoKit already uses fails at startup. `podo update` creates the file once
  and never overwrites it.
- The bullmq module's `apps/api/src/worker.extensions.ts` is an
  application-owned `configureWorkers(setup)` that returns the queues the
  worker process consumes next to the demo queue, with optional BullMQ worker
  options. Resources it opens are released with `setup.onClose` after the
  workers stop, and two workers for one queue fail at startup.
  `startWorkers()` is now asynchronous and returns `{ workers, close }`.
  `podo update` creates the file once and never overwrites it.
- `DATABASE_PROVIDER`, `CACHE_PROVIDER`, `OBJECT_STORAGE_PROVIDER`,
  `EVENTS_PROVIDER`, and `JOBS_PROVIDER` replace the project's provider for one
  capability when the API starts, so one build can run on PostgreSQL on a
  server and SQLite in a desktop shell. An unknown value, or a provider whose
  module is not installed, fails startup. `config/providers.ts` passes the
  project's selection through `providersFromEnvironment()` from the new
  `config/provider-selection.ts`, and `podo provider set` writes it that way.
- `apps/api/scripts/build.extensions.mjs` is an application-owned list,
  `appBuildTargets`, of entry points the API build bundles next to PodoKit's,
  such as a maintenance command run from the image. A missing entry point fails
  the build. `podo update` creates the file once and never overwrites it.
- The jobs contract repeats jobs. `JobQueue.schedule(id, name, payload,
  { cron | everyMs, timezone? })` adds a `name` job on a cron expression or a
  fixed interval and replaces an earlier schedule with the same id, and
  `unschedule(id)` stops it. The BullMQ provider stores them as Redis job
  schedulers, and the local provider adds the jobs from a timer, once per time.
  Both keep their schedules and apply them again when the connection is
  restored, `schedule()` resolves while the backend is down, and an invalid
  schedule rejects. `@podosoft/podokit-runtime` exports `RepeatOptions`,
  `assertRepeatOptions()`, and `MIN_REPEAT_INTERVAL_MS`.
- The admin Settings page shows the application's flags. Each flag listed in
  `APP_FLAG_SETTINGS` of the application-owned
  `apps/web/src/lib/admin/app-flags.ts` (admin-dashboard) gets a switch on an
  Application tab, labelled from the app's own catalog, that saves through
  `PUT /account/settings` like the Authentication tab's switches. The tab is
  hidden while the list is empty. `podo update` creates the file once and never
  overwrites it. The settings page's tab list now wraps instead of reaching
  into the page margin on narrow screens.

### Changed

- `README.md`, `tests/README.md`, `.gitignore`, `.env.example`,
  `.env.docker.example`, and the example manifests in `infra/k3s/` are owned
  seeds. Applications rewrite them, so as managed files they showed up as
  edited forever and every update merged or conflicted there. `podo add` and
  `podo remove` still write a module's environment lines and wiring into them,
  `podo update` lists their template changes for review, and a deleted
  `infra/k3s/` is no longer restored. `app.css` keeps its application styles in
  the owned `app.extensions.css`.
- PodoKit's own agent skills, `.claude/skills/podokit-*` and
  `.agents/skills/podokit-*`, are managed. They were owned like the rest of
  `.claude/**` and `.agents/**`, so an update never brought their corrected
  commands and APIs, such as a data table skill that still used an old `$lib`
  path. Skills under other names stay owned.

### Removed

- The `tests/helpers/exclusive.ts` lock helper and its self-test. The exclusive
  phase replaces the locks, which kept apart only the tests that changed the
  same setting, not the tests that relied on its default.
- `clearMailpit()` and `clearSms()` from the generated e2e helpers. They emptied
  the Mailpit inbox and SMS sink that every test reads, so a test running at the
  same time lost its message. Each test already sends to recipients of its own.

### Fixed

- The Outer harness, `scripts/e2e-ci.mjs`, runs npm and npx against its local
  registry with an npm cache inside the run's directory. It installed the
  locally published `@podosoft/podokit` through the user's npx cache, where a
  later `npx @podosoft/podokit@<same version>` ran it as the release, and it
  deleted the whole `~/.npm/_npx` at the start of each run.
- The account sessions specs (API and UI) no longer spend the per-address
  sign-in budget: each made 105 anonymous sign-ins, so a run with a raised
  `RATE_LIMIT_AUTH_MAX` of 300 refused sign-ins of unrelated specs within the
  same minute. Only the first sign-in is anonymous now; the others carry its
  session, which the rate limiter counts on its own. The `rate-limit` spec signs
  up its accounts the same way. They still prove more than 100 sessions and
  that signing out the others removes them all.
- The passkey spec checks that signing out worked and that the passkey signed
  the user back in. It ignored the sign-out response and relied on the owned
  login page to redirect a browser that was still signed in; on an app whose
  login page shows the form anyway, the browser reached `/` without the passkey.
- The users-admin spec removes the account if the forbidden create-user request
  succeeds.
- The Silo and `mc` images of `compose.dev.yaml` and the `object-storage-s3`
  module's `infra/docker/minio.compose.yml` are pinned by digest, and their
  bucket setup runs with `sh -e` and `mc mb --ignore-existing`. `mc mb … ||
  true` and a trailing `exit 0` hid a bucket that could not be created, so
  uploads failed later instead.
- `podo update --apply` refuses when an external module package in
  `node_modules` is older than the version the project last applied, and the
  dry run warns about it. It used to write the older module's files and record
  the older version without a word.
- The root `package.json` of an app with two or more external modules no
  longer stays marked as edited. Bun writes `devDependencies` sorted by name,
  while PodoKit rebuilt the section in module order, so `podo status` and
  `podo update` reported a change nobody made.
- `podo dev` sets `CORS_ORIGIN` and `BETTER_AUTH_URL` for the web and API
  containers from `.podokit/dev.json`, and the generated
  `.env.docker.example`, `tests/README.md`, and `README.md` render its hostname.
  A project that changed the hostname in `dev.json` still got the project-name
  hostname from `.env.docker`, so sign-in failed with an invalid origin until
  the app edited the env files or overrode both values in `compose.dev.yaml`.
  `PODOKIT_DEV_AUTH_URL` switches `BETTER_AUTH_URL` to `publicUrl` for an OAuth
  round trip through a tunnel.
- A Compose deployment behind a reverse proxy can trust `X-Forwarded-Proto` and
  `X-Forwarded-Host`: the guide told profiles to set `PROTOCOL_HEADER` and
  `HOST_HEADER`, which `runtimeConfig` refuses as managed keys, and the Compose
  renderer never set them. They now follow `exposure.edgeProxies`. A Kubernetes
  NodePort profile without edge proxies no longer trusts forwarded headers that
  any client can send.
- `podo deploy plan` and `render` derive `CONNECTION_IDLE_TIMEOUT` and
  `API_IDLE_TIMEOUT` from the application's `APP_PROXY_TIMEOUTS` as well as
  `BACKEND_PROXY_TIMEOUT_MS`: `0` when an entry has `timeoutMs: null`,
  otherwise the longest wait's whole seconds plus 5. Before, they saw only
  `BACKEND_PROXY_TIMEOUT_MS`, so an app with a longer or unbounded route had to
  set both by hand or its web server refused to start. PodoKit reads
  `apps/web/src/lib/server/proxy-timeouts.ts` as text without running it, and
  the plan fails with the line it stopped at when an entry is not a literal;
  `podo deploy doctor` fails a `CONNECTION_IDLE_TIMEOUT` in `runtimeConfig`
  that cannot cover the longest wait and warns about such an `API_IDLE_TIMEOUT`.
- Production deployments of apps with the `audit-log` module start with the
  audit log on. `podo deploy init` sets `AUDIT_LOG_ENABLED: "true"` in the
  profile's `runtimeConfig` for both drivers, and the module adds it to the
  example `infra/k3s/configmap.yaml`; before, only `.env.example` and
  `.env.docker.example` set it.
- The Compose deployment gateway sends web and API the one client address it
  resolved, instead of appending the proxy in front to `X-Forwarded-For`. Behind
  a proxy listed in `exposure.trustedProxyCidrs`, web and API received
  `X-Forwarded-For: <client>, <proxy>`, and with `XFF_DEPTH=1` and
  `TRUSTED_PROXY_HOPS=1` both recorded the proxy's address for sessions, audit
  entries, and rate limits. Every gateway `reverse_proxy` now sets
  `header_up X-Forwarded-For {client_ip}`; without trusted proxies the address is
  the gateway's peer, as before.
- The `/api` proxy no longer cuts a route listed in `APP_PROXY_TIMEOUTS` with
  `timeoutMs: null` after 300 seconds. Bun's `fetch` gives up on a connection
  that sends nothing for its idle timeout (300 seconds unless
  `BUN_CONFIG_HTTP_IDLE_TIMEOUT` sets another), even while the proxy still waits
  for response headers, so a request whose API legitimately took longer got
  `503` `BACKEND_UNAVAILABLE` although the API was up. The proxy now turns that
  timeout off for a request without a deadline and for a deadline of 300 seconds
  or more, from `APP_PROXY_TIMEOUTS` or `BACKEND_PROXY_TIMEOUT_MS`, so only the
  deadline, the `GET /health` checks, and the browser end the wait. Shorter
  deadlines keep Bun's default. Apps that raised `BUN_CONFIG_HTTP_IDLE_TIMEOUT`
  in the web image to work around this can remove it.
- Generated e2e specs no longer depend on data other tests change at the same
  time: the organization spec picks the seeded user as a manager instead of the
  first user listed, and the blog comment validation spec posts to a post of its
  own instead of the newest published one.
- The impersonation banner on `/account` no longer depends on the
  application-owned account page. The managed load returned `impersonating`, but
  only pages generated after the banner was added rendered it, so an updated app
  without it lost the way back to the administrator session, and the managed
  impersonation spec failed when the app's owned users page navigated somewhere
  other than `/account`. The managed `AccountPage` now renders the banner from
  the load's new `showImpersonationBanner`, and the spec opens `/account` itself.
  Pages whose server load is managed now follow one rule, described in
  [route files and update tiers](docs/templates.md#route-files-and-update-tiers),
  and a repository test fails when a template's owned page starts reading a
  new field of such a load.
- The audit log records again in apps that never set its toggle. Since 1.2.0
  every write, including `recordAudit()` from application code, follows the
  admin toggle, and the toggle fell back to `AUDIT_LOG_ENABLED === "true"`. A
  deployment without that variable and without a saved admin setting recorded
  nothing, without a warning. With the audit-log module installed, an unset or
  empty `AUDIT_LOG_ENABLED` now means on, only `false` turns it off, and the
  admin Settings toggle still overrides both. The API logs one warning at
  startup while the audit log is off. `@podosoft/podokit-auth` takes these
  defaults through a new `defaults` option of `createConfigStore()` and
  `envAuthConfig()`; the auth module's `auth-config-store.ts` holds them in
  `AUTH_CONFIG_DEFAULTS`, where the audit-log module adds `auditLog: true`.
- The built API reads `NODE_ENV` when it runs. `Bun.build` replaced
  `process.env.NODE_ENV` with `"development"` in every bundle, so a production
  image ignored `NODE_ENV=production` wherever code read it directly: the logging
  module loaded the development-only `pino-pretty` transport and the API exited
  at startup when it was missing, the auth module accepted a placeholder
  `BETTER_AUTH_SECRET` and an `http:` `BETTER_AUTH_URL`, the SQLite migration
  runner looked for source migrations and ran none, and dependencies such as
  Better Auth took their development branches. `scripts/build.mjs` now defines
  `process.env.NODE_ENV` as itself for the API, worker, and migration bundles,
  and the logging module reads the validated `NODE_ENV`.
- Migrations can no longer be lost between the build and the database without
  an error. The API build emitted the compiled migrations wherever `Bun.build`
  chose, and the data source loaded `dist/migrations/[0-9]*.js`, so an image
  whose migrations landed in `dist/migrations/src/migrations` ran none and
  `migrate:all` still succeeded. The build now pins the output to
  `dist/migrations/<file>.js`, removes the previous build's migrations, fails
  unless the output matches `src/migrations` and each file exports exactly one
  migration class, and writes `dist/migrations/migrations.json` with every file
  and migration name. In production the migrators run exactly the listed files
  and refuse to run without the list or a listed file; both migrators fail when
  they load fewer migrations than they expected. In production the API refuses
  to start without the list, and `GET /health/ready` reports a `migrations` check
  that stays down while a listed migration is missing from the database.
- `bun run --cwd apps/api migration:generate src/migrations/<Name>` works. The
  TypeORM CLI ran on Node through ts-node, which cannot load the data source's
  Bun SQL import, and under Bun it rejected the data source file's two exports.
  The `typeorm` script runs the CLI on Bun, `data-source.ts` exports only
  `appDataSource`, and the unused `ts-node` development dependency is gone.
- In production the auth module accepts an `http:` `BETTER_AUTH_URL` on a
  loopback address (`localhost`, `127.0.0.0/8`, `[::1]`), such as an API a
  desktop shell runs on `127.0.0.1`; every other address still needs `https:`.
- Sign-in works once `migrate:all` has run, even when the API started before
  it. Better Auth keeps a schema mismatch it found until a migration run by the
  same process clears it, so an API that started on an empty database, as the
  container development stack can, answered every sign-in with `500` until it
  restarted. While the auth instance holds a mismatch, the auth module rebuilds
  it at most every 2 seconds on a request, and the new instance checks the
  database again.

### Upgrade notes

- Deployment profiles refuse `ADDRESS_HEADER`, `XFF_DEPTH`,
  `TRUSTED_PROXY_HOPS`, and `TRUSTED_PROXY_HEADER` in `runtimeConfig`. Remove
  them and set `exposure.edgeProxies` instead: on Kubernetes with an Ingress to
  your old `XFF_DEPTH` minus 1 (0 for the generated default), and on Compose to
  the number of proxies in front of the published port (1 for the generated
  default). With the Compose gateway, list those proxies' CIDRs in
  `trustedProxyCidrs` too; the doctor warns until you do. A Kubernetes profile
  with an edge proxy and WebSocket or direct API paths still records the edge
  proxy for those requests, and the doctor says so.
- `podo deploy doctor` now fails a profile whose API and worker processes can
  open more PostgreSQL connections than the server allows, which stops
  `podo deploy apply`. A Kubernetes profile with a BullMQ worker and the default
  pools warns. Lower `DB_POOL_MAX` and `DB_AUTH_POOL_MAX` in `runtimeConfig`,
  set `dependencies.postgres.maxConnections` to the server's real limit, and
  list pools the application opens itself in `dependencies.postgres.appPools`.
- A deployment profile that sets `CONNECTION_IDLE_TIMEOUT` or
  `API_IDLE_TIMEOUT` only to cover an `APP_PROXY_TIMEOUTS` entry can drop them;
  the plan now derives both. An app with an entry of `timeoutMs: null` that kept
  `API_IDLE_TIMEOUT` at its default on purpose, because its API lifts the idle
  timeout per request, keeps `"API_IDLE_TIMEOUT": "35"` in `runtimeConfig`;
  otherwise the rendered value becomes `0`, and the doctor warns.
- With the `audit-log` module installed, add `"AUDIT_LOG_ENABLED": "true"` to
  the `runtimeConfig` of every existing deployment profile; `podo deploy doctor`
  warns until you do. `podo update` adds the line to the example
  `infra/k3s/configmap.yaml`, before a new `# podokit:end:runtime-config` marker.
- Every Compose deployment renders new proxy settings, and one with WebSocket or
  direct API paths a new gateway configuration, so a rollback to a revision
  applied before this version is refused, because it no longer renders byte for
  byte; roll forward with a new release instead. Sessions and audit entries
  created behind a trusted proxy before the upgrade keep the proxy's address.
- A spec of your own that imports `../helpers/exclusive` fails after
  `podo update` removes the helper. Drop the `exclusive()` wrapper and tag the
  test instead: `test("…", { tag: "@exclusive" }, async (…) => { … })`. Tag any
  other test of yours that changes a server-wide setting, a seeded account, or
  something every test needs, such as stopping a backing service. Without the
  tag it still passes on one worker but can fail others when `E2E_WORKERS` is
  above 1.
- A spec of your own that calls `clearMailpit()` or `clearSms()` fails after
  `podo update` removes them. Send to an address or phone number of the test's
  own instead, and drop the call.
- Scripts and CI jobs that run `--project=api` or `--project=ui` skip the tagged
  tests now; add `--project=api-exclusive` or `--project=ui-exclusive`. Pass
  `E2E_WORKERS` instead of `--workers`.
- If `tests/package.json` or `tests/playwright.config.ts` holds edits of yours,
  `podo update` reports a conflict; take the new scripts and config and keep
  application projects in `tests/playwright.projects.cjs`.
- `AGENTS.md` is application-owned, so `podo update` does not add its note
  about `E2E_WORKERS` and the `@exclusive` tag; copy it from a newly generated
  app if your agents should know.
- Move edits you made to the managed `vite.config.ts`, `hooks.server.ts`,
  `admin-sidebar.svelte`, or `search-indexing.ts` into the new owned files, then
  take PodoKit's version of the managed file when `podo update` reports a merge
  or conflict there. For example, a fixed user set in `loadRuntimeContext` goes
  into `appHandle`, an extra sidebar link into `APP_ADMIN_NAV`, extra
  `NON_INDEXABLE_PATH_PREFIXES` entries into `APP_NON_INDEXABLE_PATHS`, and Vite
  `define`, `optimizeDeps`, `cacheDir`, plugins, or a SvelteKit `alias` into
  `vite.extensions.ts`.
- The managed `vite.config.ts` now imports `./vite.extensions.ts`. A running
  `podo dev watch` syncs the new `vite.config.ts` but not the new file, so the
  web container stops until you run `podo dev down` and start it again, which
  rebuilds the image. `compose.dev.yaml` is application-owned; add
  `- { action: sync+restart, path: ./apps/web/vite.extensions.ts, target: /app/apps/web/vite.extensions.ts }`
  under the web service's `develop.watch` to restart the web container when the
  file changes.
- Remove a WebSocket proxy you added to `vite.config.ts` for a path that
  `.podokit/dev.json` lists; the managed configuration proxies it now.
- If you added `x-forwarded-host` or `x-forwarded-proto` to the managed
  `backend-proxy.ts`, take PodoKit's version. List every public origin the web
  app serves in `CORS_ORIGIN` of the web server's environment, or the proxy
  sends neither header.
- `routes/account/+page.server.ts` returns `showImpersonationBanner` instead of
  `impersonating`, and the managed `AccountPage` renders the banner. Remove the
  `{#if data.impersonating}` block and the `ImpersonationBanner` import from your
  owned `routes/account/+page.svelte`; they no longer render anything. If you
  reverted the managed load or edited `tests/ui/impersonation.ui.spec.ts` to make
  it pass, take PodoKit's versions of both.
- A client-side workaround for that 403, such as sending uploads as
  `application/octet-stream` with the multipart type in another header or adding
  `content-type: application/json` to requests without a body, can be removed
  once `tests/ui/same-origin-requests.ui.spec.ts` passes against the deployment
  without it. Fix the forwarded scheme in the ingress first if it does not.
- If you added `lightClassNames` to the managed `site-runtime.svelte`, take
  PodoKit's version. A rule of your own for a `.light` class now also matches
  `<html>` in light mode; scope it if it was meant for one element.
- Move your edits to the managed `app.css`, such as theme variables, fonts, base
  styles, or `@source` lines, into `apps/web/src/app.extensions.css`, then take
  PodoKit's `app.css` when `podo update` reports a merge or conflict. A relative
  `@source` path keeps working because both files are in `apps/web/src`.
- Apps with the audit-log module that never set `AUDIT_LOG_ENABLED` and never
  saved the audit toggle on the admin Settings page start recording audit
  entries after `podo update`. To keep the log off, set `AUDIT_LOG_ENABLED=false`
  or turn the toggle off on the Settings page; a saved setting wins over the
  environment. An app that wants the entries it missed cannot recover them; the
  log starts with the update.
- An "audit log is off" warning at API startup means a saved setting or
  `AUDIT_LOG_ENABLED=false` keeps the log off; check that this is intended.
- Authenticator entries enrolled before this update keep the "Better Auth"
  label; new enrolments use the app name. Set `AUTH_APP_NAME` if neither the
  site name nor the project name is the name your users know.
- A production API image built after this update enforces the production
  checks it skipped before: it refuses to start with an unset or placeholder
  `BETTER_AUTH_SECRET` or a `BETTER_AUTH_URL` that is not `https:`. Fix the
  deployment's environment before you roll the image out. An app that added
  `define: { "process.env.NODE_ENV": JSON.stringify("production") }` to
  `scripts/build.mjs` can drop it; `podo update` reports the edit as a conflict,
  so take the new file.
- `podo update` replaces `scripts/build.mjs`, `src/database/data-source.ts`, and
  `src/database/migrate.ts`. Apps that pinned `root: "src/migrations"` in the
  build or added their own migration count check (for example an
  `assertMigrationsLoaded` call or a static migration registry) can drop those
  edits. A migration file that exports more than one class, such as a helper
  class next to the migration, now fails the build; move the helper to another
  file. After the update a production API image refuses to start unless it was
  built with the new `scripts/build.mjs`, and its `/health/ready` stays `503`
  until `migrate:all` has applied the image's migrations, so keep the migration
  job ahead of the rollout.
- Move application variables you added to the managed
  `apps/api/src/config/env.validation.ts` into `appEnvShape` in
  `apps/api/src/config/env.extensions.ts`, and a `superRefine` of yours into
  `refineAppEnv`; `podo update` reports the old edit as a conflict. Production
  checks of `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are not needed there: the
  auth module makes them, and since this release they also run in the built API.
- Move entities you listed in the managed `apps/api/src/database/data-source.ts`
  into `APP_ENTITIES` in `apps/api/src/database/entities.ts`, and drop the
  decorator settings you added to `apps/api/tsconfig.json`; `podo update`
  reports those edits as conflicts. Import `appDataSource` by name: the default
  export of `data-source.ts` is gone.
- If you subclassed `AppException` to carry `details` and edited `app.ts` to
  return them, drop both and pass `details` to `AppException` from
  `@podosoft/podokit-contracts`; `podo update` reports the `app.ts` and
  `common/app-exception.ts` edits as conflicts.
- Move route lists you check in the managed `scripts/verify-api-contract.ts` or
  `src/core/api-contract.ts` into `APP_DOCUMENTED_ROUTES`; `podo update`
  reports those edits as conflicts.
- Move flags you added to the managed `apps/api/src/settings/flag-defaults.ts`
  into `APP_FLAG_DEFAULTS` in `apps/api/src/settings/app-flags.ts`, and read
  them from `appFlags` of `GET /account/capabilities` instead of a route of your
  own in `auth.module.ts`; `podo update` reports those edits as conflicts. A
  stored row keeps its value, so a migration that seeded one can stay.
- Move queues you added to the managed `apps/api/src/jobs/worker.module.ts`,
  and setup you added to `main-worker.ts`, into `configureWorkers()` in
  `apps/api/src/worker.extensions.ts`; `podo update` reports those edits as
  conflicts. Code of yours that calls `startWorkers()` awaits it now and stops
  the workers with the returned `close()`.
- If you edited `apps/api/src/config/providers.ts` to choose providers from
  your own variables, set the `<CAPABILITY>_PROVIDER` variables instead and take
  the new file; `podo update` reports the edit as a conflict. Check that none of
  those five names is already in your environment for another purpose.
- Move build targets you added to the managed `apps/api/scripts/build.mjs` into
  `appBuildTargets` in `apps/api/scripts/build.extensions.mjs`; `podo update`
  reports the edit as a conflict.
- A `JobQueue` implementation of your own, including a test fake, must add
  `schedule()` and `unschedule()`. An app that ran its own repeating scheduler
  beside the jobs provider can move it to `schedule()`.
- To show an application flag on the Settings page, add it to
  `APP_FLAG_SETTINGS` in `apps/web/src/lib/admin/app-flags.ts` with labels in
  `i18n/catalogs/app/*.json`, and drop what you added for it to the managed
  settings `+page.server.ts` and the admin-dashboard catalogs; `podo update`
  reports those edits as conflicts. The tab list's wrapping reaches only new
  apps, because the settings `+page.svelte` is application-owned; add
  `class="h-auto max-w-full flex-wrap justify-start"` to its `<Tabs.List>` if
  your tabs overflow on a phone.
- Managed e2e specs now read the application's screens and seeded accounts
  from `tests/helpers/app-paths.ts` and `tests/helpers/app-accounts.ts`, which
  `podo update` creates. Put your first screen's locator, public pages, and
  account addresses there, then run `podo restore <spec>` for every spec you
  ejected or edited only to change those, such as `smoke.ui.spec.ts`,
  `guards.ui.spec.ts`, `dashboard.ui.spec.ts`, `account.ui.spec.ts`, and
  `tests/helpers/accounts.ts`. Keep tests of your own screens in specs of your
  own.
- The first `podo update` turns `README.md`, `tests/README.md`, `.gitignore`,
  `.env.example`, `.env.docker.example`, and `infra/k3s/**` into owned files
  without changing them; the plan shows them as `skip`, or `review` where the
  template changed. Copy what you want from `podo diff <path>`, for example a
  new `.gitignore` rule or a module's environment line.
- Remove `CORS_ORIGIN` and `BETTER_AUTH_URL` overrides you added to the web and
  api services of `compose.dev.yaml` for a renamed development host; `podo dev`
  sets both from `.podokit/dev.json` and wins over `compose.dev.yaml` and
  `.env.docker`. Use `PODOKIT_DEV_AUTH_URL=<publicUrl> podo dev watch` instead of
  a variable of your own for the OAuth tunnel.
- `compose.dev.yaml` is application-owned, so `podo update` lists it for
  review instead of pinning its storage images. Copy the `image:` digests and
  the `minio-init` entrypoint from `podo diff compose.dev.yaml`.
- `podo update` replaces unedited `podokit-*` skills and merges edited ones
  (pass `--from` with the previous templates; without it an edited skill is
  listed as a conflict and left as it is). To keep your own copy of one, add
  its exact path to `ownedGlobs` in `.podokit/manifest.json` before applying.

## [1.5.0] - 2026-10-16

### Added

- `apps/web/src/lib/server/proxy-timeouts.ts` is an application-owned
  `APP_PROXY_TIMEOUTS` list of `{ pathPrefix, timeoutMs }` entries for `/api`
  routes. An entry replaces `BACKEND_PROXY_TIMEOUT_MS` for its path and the paths
  below it, matched by the same path rules as `APP_BODY_LIMITS`, and
  `timeoutMs: null` waits as long as the API takes. The proxy now also repeats
  its `GET /health` check every `BACKEND_TIMEOUT_MS` while it waits for response
  headers, so a request on such a route still ends with `503`
  `BACKEND_UNAVAILABLE` when the API stops answering partway through the wait.
  An invalid prefix or timeout fails when the web server loads the proxy.
  `podo update` creates the file once in existing apps and never overwrites it.
- Path prefixes take `:name` parameters in the rate-limit module's route
  profiles (`RATE_LIMIT_ROUTES`), `APP_BODY_LIMITS`, and `APP_PROXY_TIMEOUTS`. A
  parameter matches exactly one non-empty path segment, matching still covers
  whole segments and the paths below them, and the most specific prefix wins:
  more segments, then, from the left, a literal segment over a parameter, then
  the earlier tie-breakers (for rate limits, a route with a method, then the
  latest registration). Routes keyed by an id in the middle of the path no longer
  need edits to the managed `backend-proxy.ts`. For example, to give transfers
  under every host their own request budget, a body cap for 1 MiB chunks, and no
  proxy deadline:

  ```ts
  // apps/api/src/app.extensions.ts
  import { RATE_LIMIT_ROUTES } from "@podosoft/podokit-runtime";

  export function configureServices(services: ServiceRegistry): void {
    services.tryResolve(RATE_LIMIT_ROUTES)?.register({
      pathPrefix: "/hosts/:hostId/file-transfers",
      profile: { name: "file-transfers", limit: 3000 },
    });
  }

  // apps/web/src/lib/server/body-limits.ts
  export const APP_BODY_LIMITS: ReadonlyArray<{ pathPrefix: string; maxBytes: number }> = [
    { pathPrefix: "/api/hosts/:hostId/file-transfers", maxBytes: 1024 * 1024 + 64 * 1024 },
  ];

  // apps/web/src/lib/server/proxy-timeouts.ts
  export const APP_PROXY_TIMEOUTS: ReadonlyArray<{ pathPrefix: string; timeoutMs: number | null }> = [
    { pathPrefix: "/api/hosts/:hostId/file-transfers", timeoutMs: null },
  ];
  ```

  A route without a deadline also needs `API_IDLE_TIMEOUT=0` and
  `CONNECTION_IDLE_TIMEOUT=0`. Parameter names are a letter or `_` followed by
  letters, digits, or `_`; wildcards such as `*`, `.` or `..` segments, and
  malformed parameters are rejected, and the web lists also reject two prefixes
  that cover the same paths, such as `/api/a/:x` and `/api/a/:y`.

### Changed

- The rate-limit module counts a signed-in caller per user instead of per
  session, so one user's sessions on several devices, addresses, or API replicas
  draw from one budget, and API keys still come first and unsigned or forged
  sessions still count by client address. The limiter still reads no session
  from the database: each API process remembers the user of every session that
  authentication resolves for a request, reported through the new
  `RESOLVED_SESSIONS` registry in `apps/api/src/core/services.ts`, until the
  session expires (at most 10,000 sessions per process). Until then a session
  keeps a counter of its own, so the first request of a new session, or its
  first on another API process, can count separately; with `auth` registered
  before `rate-limit`, a route that requires a session resolves it before the
  limiter runs. Better Auth's own routes, such as `/api/auth/get-session`, do not
  report sessions. Measured on a generated app with PostgreSQL and Redis, an
  authenticated request makes the same Redis calls (one `EVALSHA` for the
  counter) and the same SQL queries as before. Signing out, revoking, and banning
  still take effect on the next request; a remembered session only selects a
  counter.

### Fixed

- The built web server keeps a connection open for 35 seconds while it sends
  nothing: the web image, `.env.example`, the reference Kubernetes config, and the
  Compose and Kubernetes deployment renders set `CONNECTION_IDLE_TIMEOUT=35`.
  Without it adapter-bun used Bun's default of 10 seconds, so a proxied request
  whose API answer took longer got an empty reply after 8 to 12 seconds, and the
  proxy's `504` `BACKEND_TIMEOUT` at `BACKEND_PROXY_TIMEOUT_MS` never arrived.
  Bun checks idle connections every 4 seconds and can close one up to 4 seconds
  early, so the value must be more than 4 seconds above the longest proxy
  deadline, at most 255, or `0` to turn the timeout off. The renderers derive it
  from the profile's `BACKEND_PROXY_TIMEOUT_MS` unless `runtimeConfig` sets it,
  and the proxy refuses to load when a set value cannot cover
  `BACKEND_PROXY_TIMEOUT_MS` or an `APP_PROXY_TIMEOUTS` entry. Server-sent events
  were not affected, because adapter-bun lifts the timeout for them.
- The API keeps a connection open for 35 seconds while it sends nothing, instead
  of Elysia's 30, and reads the value from `API_IDLE_TIMEOUT` (0 to 255, 0 turns
  it off; an empty value counts as unset, and `apiServerOptions.idleTimeout`
  still wins). With Bun's 4-second idle checks, 30 cut an endpoint that answered
  after 28 to 30 seconds, inside the web proxy's 30-second deadline, so the proxy
  answered `503` `BACKEND_UNAVAILABLE`, and the API also cut every route with a
  longer `APP_PROXY_TIMEOUTS` deadline. The Compose and Kubernetes renderers
  derive `API_IDLE_TIMEOUT` from `BACKEND_PROXY_TIMEOUT_MS` the same way as
  `CONNECTION_IDLE_TIMEOUT`, and the reference Kubernetes config sets it.
- The `todo` template's `AGENTS.md` gives the same guidance as the `fullstack`
  one it extends, plus its todo example. It had fallen behind and left out the
  web server's `GET /healthz` route, the API timeouts, `apiServerOptions` and
  its environment fallbacks, and `podo dev`, including that `podo dev down` also
  stops `podo dev watch`.
- After `podo provider set <capability> <provider> --apply`, the API type-checks
  again. The generated `apps/api/src/config/providers.ts` declared `PROVIDERS` with
  `as const`, so each field had the type of the selected provider only, and the
  previous provider's module, which stays installed and inactive for a rollback,
  failed `tsc` on its own check, such as `PROVIDERS.cache !== "memory"` in
  `cache-memory.module.ts` after switching the cache to Redis (TS2367). This hit
  every switch of the cache, object storage, events, and jobs providers, in both
  directions. `PROVIDERS` is now typed `Readonly<ProviderSelections>`, with every
  provider name of each capability.
- The account page's Sessions tab shows the current session and every other one,
  however many there are. It read Better Auth's `GET /api/auth/list-sessions`,
  which returns at most 100 sessions in no set order, so a user with more
  sessions could see no "Current" row and only part of the list. The admin dashboard adds
  `GET /account/sessions`, the caller's own sessions paged on the server with the
  current one on every page and no tokens, and `DELETE /account/sessions/{id}`,
  which revokes through Better Auth's audited `/revoke-session`. The list keeps
  Better Auth's `SESSION_NOT_FRESH` rule. API and UI specs cover a user with 106
  sessions and paging.
- The admin dashboard's table toolbar keeps its search box usable on a phone.
  The input could shrink to about 42 px wide at a 390 px viewport, squeezed
  between the search field select and the Search button on the users page; it
  now keeps at least 192 px and wraps to its own row with the button, about
  242 px wide there. Desktop layouts are unchanged.

### Security

- "Sign out other sessions" (`POST /api/auth/revoke-other-sessions`) revokes
  every other session of the user. Better Auth 1.7 lists a user's sessions
  through the adapter's default findMany limit of 100 and revoked only those, so
  a user with more sessions kept the rest signed in, and had to repeat the
  action once per hundred. The auth module adds the `revokeEveryOtherSession`
  Better Auth plugin, which revokes the remaining sessions in batches through the
  internal adapter after the endpoint runs, secondary-storage entries included.
  Measured with 151 sessions: one call leaves only the current session, where it
  left 52 before. The admin dashboard's test seed now clears an account's earlier
  sessions with one call.
- Audit entries, Better Auth sessions, and Better Auth's own per-address limits
  no longer take the client address from a header the caller controls. The
  audit-log module stored `X-Forwarded-For` exactly as received, and Better Auth
  trusted a single-entry `X-Forwarded-For`, so a caller that reached the API
  directly, or through more proxies than trusted, could write any address, or a
  list of them, into the audit trail and the session list, and change addresses
  to dodge sign-in limits. The API now resolves the address once per request in
  `apps/api/src/core/client-address.ts`: the socket peer, or with
  `TRUSTED_PROXY_HOPS` set, the entry of `TRUSTED_PROXY_HEADER` that the
  outermost trusted proxy appended. It stores the result in the
  `x-podokit-client-address` request header, replacing any value the caller
  sent, and Better Auth (`ipAddressHeaders`), the audit hook,
  `AuditService.recordRequest()`, and the rate limiter all read that one value.
  These settings move from the rate-limit module (`RATE_LIMIT_TRUSTED_PROXY_HOPS`,
  `RATE_LIMIT_PROXY_HEADER`) to the API core. The generated `.env.example`,
  `.env.docker.example`, Kubernetes example, and new deployment profiles set
  `TRUSTED_PROXY_HOPS=1`, for the web proxy or gateway in front of the API.

### Upgrade notes

- If you edited `apps/web/src/lib/server/backend-proxy.ts` to give some routes a
  longer deadline or none, or a body limit of their own, `podo update` reports a
  conflict where the new proxy picks them. Take the new version, list those
  routes in `APP_PROXY_TIMEOUTS` and `APP_BODY_LIMITS`, with `:name` for an id in
  the path, and keep the managed file unchanged so later updates stay clean.
- A route that calls Bun's `server.timeout(request, 0)` through `platform.server`
  to keep a long request open gets no longer timeout behind an HTTPS gateway:
  adapter-bun rewrites the request onto the public origin there, and Bun ignores
  the call for the rewritten request. Set `CONNECTION_IDLE_TIMEOUT` instead, `0`
  for a route without a deadline.
- `podo update --apply` sets `CONNECTION_IDLE_TIMEOUT=35` in the managed web
  `Dockerfile`, `.env.example`, and `infra/k3s/configmap.yaml`. Add it to your
  `.env` if you run the built web server with it. If you set
  `BACKEND_PROXY_TIMEOUT_MS` above 30000 outside a deployment profile, such as in
  a hand-managed ConfigMap, set `CONNECTION_IDLE_TIMEOUT` more than 4 seconds
  above it as well. With the image's 35 the proxy refuses to load until it can
  cover the deadline: the web server stops at startup in apps with server hooks,
  and otherwise every `/api` request answers `500`.
- Rate limits now apply per user. If you sized `RATE_LIMIT_MAX` or a route
  profile for one session and your users stay signed in on several devices at
  once, raise it to cover all of them.
- `AuthService` takes its session resolver in an options object,
  `new AuthService(settings, accessPolicy, { resolveSession, resolvedSessions })`.
  Code of your own that constructs it with a resolver as the third argument
  passes `{ resolveSession }` instead.
- An API that relied on Elysia's default idle timeout of 30 seconds now uses 35;
  an `idleTimeout` in `apiServerOptions` keeps its value and still wins over
  `API_IDLE_TIMEOUT`.
- The deployment renderers now set `CONNECTION_IDLE_TIMEOUT` and
  `API_IDLE_TIMEOUT`, so a Compose
  rollback to a revision applied before this version is refused, because it no
  longer renders byte for byte; roll forward with a new release instead.
- Rename `RATE_LIMIT_TRUSTED_PROXY_HOPS` to `TRUSTED_PROXY_HOPS` and
  `RATE_LIMIT_PROXY_HEADER` to `TRUSTED_PROXY_HEADER` in your `.env`,
  `.env.docker`, deployment profiles' `runtimeConfig`, and any hand-managed
  ConfigMap. The API refuses to start, and deployment profiles fail to load,
  while the old names are set, because falling back to the default of 0 would
  attribute every request through the web proxy to the web server. Apps without
  `rate-limit` set `TRUSTED_PROXY_HOPS=1` too, so audit entries and sessions keep
  the browser's address. Code of your own that read `X-Forwarded-For` for an
  address should call `clientAddressOf(request.headers)` instead, and a custom
  request guard reads `context.clientAddress`.
- `podo update --apply` rewrites the managed `apps/api/src/config/providers.ts`
  with the new `PROVIDERS` type. If you ejected or edited that file, replace
  `} as const satisfies ProviderSelections;` with `};` and declare
  `export const PROVIDERS: Readonly<ProviderSelections> = {` yourself.
- `AGENTS.md` is application-owned, so `podo update` does not add its new notes
  about `APP_PROXY_TIMEOUTS`, `CONNECTION_IDLE_TIMEOUT`, and `API_IDLE_TIMEOUT`;
  copy them from a newly generated app if your agents should know.

## [1.4.2] - 2026-10-16

### Fixed

- With the OIDC provider turned off in the admin settings, its discovery
  documents (`/api/auth/.well-known/openid-configuration`,
  `/api/auth/.well-known/oauth-authorization-server`, and the RFC 8414 form
  outside the base path) answer 404 like the provider's other endpoints.
  `@better-auth/oauth-provider` serves them from its own request hook, which
  ran before the feature gate, so they stayed public. The auth module registers
  the feature gate as the first Better Auth plugin as well, and the admin
  dashboard's API tests toggle the provider and check both states. The `jwt`
  plugin's `/api/auth/jwks` and `/api/auth/token` stay available.

- `isDatabaseUnavailable` also recognizes a database host that does not
  resolve (`ENOTFOUND`) or whose lookup times out (`ETIMEOUT` in Bun,
  `EAI_AGAIN` in Node), pg's "Connection terminated", "Client was closed and is
  not queryable" and "Client has encountered a connection error and is not
  queryable", the per-address errors of an `AggregateError` (a connection to
  `localhost` that tried IPv6 and IPv4), and the `driverError` of TypeORM's
  `QueryFailedError`. Those failures answer 503 `DATABASE_UNAVAILABLE` instead
  of 500, so applications no longer need their own translation.

- `apps/api/scripts/run-migrations.mjs`, the launcher behind `migrate:all`,
  runs the migration in `apps/api` wherever it is started from, such as the
  repository root or a tool with another working directory. Bun 1.4.0 reads
  decorator settings (`experimentalDecorators`, `emitDecoratorMetadata`) from
  the `tsconfig.json` of the working directory, so TypeORM entities with
  decorators failed to load outside `apps/api`, and the data source looked for
  `.env` and the migrations relative to the wrong directory.

- `.podokit/files.lock` never records local environment files such as `.env`,
  `.env.docker`, `.env.local` or `apps/api/.env`, which Git ignores and which
  hold secrets; the committed `.env.example` and `.env.docker.example` are still
  recorded. `podo update` wrote the hash of `.env.docker` into the lock, and
  after `podo add`, `podo remove` or `podo provider set` recorded `.env` as a
  managed file, the next `podo update` deleted it as removed upstream. Entries
  an earlier version wrote are ignored and dropped on the next lock write.

- The admin dashboard's Playwright specs that change a server-wide setting hold
  a lock shared by every worker on the machine (`tests/helpers/exclusive.ts`).
  The suite runs on one worker by default; with `--workers` above 1, an api spec
  and a ui spec could flip the same setting at once and undo each other. The
  locks cover the `require2fa`, magic-link and OIDC provider flags, automatic
  logout, social sign-in providers, the General settings (the form saves all of
  its fields together) and the Appearance settings. A failing test releases its
  lock, a lock left by a worker that exited (Ctrl-C, a timed-out test) is taken
  over at once, and locked tests call `test.slow()` because waiting counts
  against their timeout.
- Generated web apps no longer wait on an API that stops answering. Each
  server-side call through `serverApiClient`, such as the hooks' site settings
  and session lookups, gives up after `BACKEND_TIMEOUT_MS` (2000 ms by default),
  so public pages render their fallbacks and protected pages answer `503`. The
  `/api` proxy answers `504` `BACKEND_TIMEOUT` when the API sends no response
  headers within `BACKEND_PROXY_TIMEOUT_MS` (30000 ms, the API's default idle
  timeout), and `503` `BACKEND_UNAVAILABLE` with `Retry-After: 2` and the
  standard error envelope instead of SvelteKit's bare `500` when it cannot reach
  the API; streamed responses are not cut off. When a call gets no answer, or
  response headers take longer than `BACKEND_TIMEOUT_MS`, the web server checks
  the API's `GET /health`, so one slow endpoint does not fail other requests.
  When that check gets no answer either, requests still waiting fail, new calls
  fail at once (`BackendUnavailableError` on the server, `503` through the
  proxy), and a check every two seconds ends the outage at the first HTTP
  answer. Raising the API's `apiServerOptions.idleTimeout` needs a matching
  `BACKEND_PROXY_TIMEOUT_MS`.
- The admin dashboard's `oidc.ui.spec.ts` reads the JWKS through the app under
  test. It requested discovery's `jwks_uri` directly, which failed with a JSON
  parse error when `BETTER_AUTH_URL` is a public origin the runner cannot use,
  such as a tunnel set as `publicUrl` in `.podokit/dev.json` that answers with an
  access login page. The spec now checks that `jwks_uri` has the issuer's origin
  and requests its path from the tested app.
- The admin dashboard's `request-budget.ui.spec.ts` reads each `__data.json`
  body through `page.route` instead of `response.text()`. Chromium can report
  that fetch as aborted (`net::ERR_ABORTED`) once SvelteKit has consumed the
  body and then keeps no body, so the spec failed with "No data found for
  resource" even though the page had its data.
- The web server has its own health route, `GET /healthz`, which answers `200`
  with `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow` without
  the session, the site settings, or any other API call. The rendered Kubernetes
  web readiness and liveness probes, the Compose healthcheck, the web image's
  `HEALTHCHECK`, and the reference `infra/k3s/web-deployment.yaml` request it
  instead of `/`, so an API outage no longer takes the web pods out of service or
  restarts them while the pages could still render their fallbacks. The
  Kubernetes web probes allow `timeoutSeconds: 2`, like the API probes.

### Upgrade notes

- `podo update --apply` adds `apps/web/src/routes/healthz/+server.ts` as an
  application-owned file, the way it adds other new routes, and updates the
  managed web `Dockerfile`, `infra/k3s/web-deployment.yaml`, and the admin
  dashboard's `runtime-context.ts`, which skips the session and site settings
  for `/healthz`. An app that already has a file at that path keeps its own, so
  make sure it answers `200` without calling the API.
- The deployment renderer in this version probes `/healthz`. Build and push a
  release from the updated app before you deploy with it: a web image built from
  older templates has no such route, so its pods never become ready and a Compose
  web container stays unhealthy. A Kubernetes rollback to a revision deployed
  before the upgrade keeps that revision's probes. A Compose rollback to such a
  revision is refused, because its healthcheck no longer renders byte for byte;
  roll forward with a new release instead.
- `AGENTS.md` is application-owned, so `podo update` does not add its new notes
  about the health route and the API timeouts; copy them from a newly generated
  app if your agents should know.


## [1.4.1] - 2026-10-16

### Fixed

- `isDatabaseUnavailable` also recognizes refused, reset and unreachable
  connections, pg's "Connection terminated unexpectedly", and the server-shutdown
  and connection-exception SQLSTATEs (57P01, 57P02, 57P03, class 08), so those
  failures answer 503 `DATABASE_UNAVAILABLE` instead of 500.

- The generated `apps/api/src/database/pool-guard.spec.ts` declares the row
  types of two awaited queries, so `bun run lint` passes with every
  `@types/bun` version the template allows. With 1.3.9 through 1.4.2, the
  `expect()` overload for a missing value made TypeScript infer those rows as
  `undefined`.
- `migrate:all` is the one migration command for every generated app. On a new
  database, `migration:run` failed at `IndexSessionCreatedAt1792060000000` with
  `relation "session" does not exist`, because only `migrate:all` creates
  Better Auth's tables. The admin dashboard's session index migration and the
  blog module's migration now stop with a message that names
  `bun run --cwd apps/api migrate:all` instead; the blog migration no longer
  skips its author foreign keys without the `user` table. The base template
  owns the `apps/api/scripts/run-migrations.mjs` launcher, which runs the
  source in development and the compiled output in a production image and
  prefers the auth module's entry, so apps without auth can run `migrate:all`
  before a build. READMEs, AGENTS.md, module instructions, and the docs set up
  with `migrate:all`; `podo update` adds the launcher to existing apps.
- The file-upload module's `chunked-uploads.api.spec.ts` passes on a
  containerized dev stack. Like the S3 storage spec, it downloads the completed
  object through the presigned URL and checks its SHA-256 only when the runner
  has `S3_ENDPOINT`, because the API signs the URL for an in-network host such
  as `minio` that a host-side runner cannot resolve. It always downloads the
  signed API path that local storage returns.
- Generated web apps have an application-owned `apps/web/src/error.html`, the
  page SvelteKit serves when the root layout or a server hook fails, such as
  with 503 while the API is down. It is self-contained HTML with inline styles
  for light and dark color schemes and shows only the status and the error
  message, so it needs no translations. `podo update` creates it once in
  existing apps and never overwrites it, including an `error.html` an app
  already has.

## [1.4.0] - 2026-10-16

### Added

- `E2E_SKIP_RATE_LIMIT=true` skips the rate-limit module's Playwright spec, so a
  local stack with raised limits can run the rest of the suite in one go.

- The MCP server's `add_module` tool lists the direct API paths it merged into
  `.podokit/dev.json` and the deployment profiles, and `preview_update` lists the
  ones an update would add, with the reason for any it would skip.

- `exposure.apiPaths` in deployment profiles and `apiPaths` in
  `.podokit/dev.json` list static prefixes under `/api/`, such as
  `/api/files/uploads/`, that the gateway sends straight to the API with `/api`
  removed, so large upload bodies never pass through the web server or its
  `BODY_SIZE_LIMIT`. The Kubernetes driver renders a second Ingress with a
  Traefik `stripPrefix` Middleware (and `podo deploy doctor` checks the
  Middleware CRD), the Compose driver routes them through its Caddy gateway,
  and `podo dev` through the shared Traefik gateway. `/api/auth`, wildcards,
  overlapping entries, and paths covering a WebSocket path are rejected; the
  plan names the direct paths. Apps that split uploads into 2 MiB chunks to fit
  through the web proxy can send larger parts on a direct path instead.
- `apps/web/src/lib/server/proxy-headers.ts` is an application-owned pair of
  lists, `APP_FORWARDED_REQUEST_HEADERS` and `APP_RELAYED_RESPONSE_HEADERS`,
  that the managed `/api` proxy merges into its header allowlists, so an app's
  own headers such as `x-api-key` or `x-checksum-sha256` pass through without
  editing `backend-proxy.ts`. Hop-by-hop, framing, `host`, `set-cookie`, and
  client address headers are rejected when the web server loads. `podo update`
  creates the file once in existing apps and never overwrites it.
- `apps/web/src/lib/server/body-limits.ts` is an application-owned
  `APP_BODY_LIMITS` list of `{ pathPrefix, maxBytes }` entries for `/api`
  routes. The proxy rejects a larger declared `Content-Length` at once, counts a
  streamed body as it arrives, and answers 413 `PAYLOAD_TOO_LARGE` with the
  standard error envelope without contacting the API. `BODY_SIZE_LIMIT` stays
  the ceiling for every web route, since Bun rejects larger bodies before
  SvelteKit runs, so routes that need more use `apiPaths`. `podo update`
  creates the file once in existing apps and never overwrites it.
- `apps/web/src/lib/server/asset-paths.ts` (admin-dashboard) is an
  application-owned `APP_ASSET_PATHS` list. A `+server.ts` endpoint under a
  listed prefix, such as one that serves documentation files under `/docs`,
  answers without the API calls for the session and site settings, and sees an
  anonymous `locals.user`. A page under the prefix still gets both, so it keeps
  its sign-in and maintenance checks. `podo update` creates the file once and
  never overwrites it.
- `podo dev env` creates `.env.docker` from `.env.docker.example` without
  starting the stack. The generated devcontainer runs it as its
  `initializeCommand`.
- The generated UI set includes the shadcn-svelte `textarea`
  (`apps/web/src/lib/components/ui/textarea`), vendored from the official
  registry like the other primitives. The blog and analytics modules use it
  instead of shipping their own copy and list it as a required project file.
- `apiServerOptions`, an optional export of the application-owned
  `apps/api/src/app.extensions.ts`, sets the API's Bun server options
  (`maxRequestBodySize` and `idleTimeout`) without editing the managed
  `main.ts`. `API_MAX_REQUEST_BODY_SIZE` (bytes, default 128 MiB, Bun's default)
  sets the body limit when the export leaves it out, and larger bodies receive
  `413`. Extension files generated by earlier releases keep compiling.
- `ObjectStore.put` accepts a `Blob` or a `ReadableStream` as well as bytes,
  strings, and async iterables, and both object storage providers write a
  streamed body without collecting it first. The S3 provider sends large and
  streamed bodies as a multipart upload in 8 MiB parts instead of buffering the
  whole object: streaming 200 MB and 1 GiB bodies to Silo each added about
  70 MiB of resident memory. A body that fails part way aborts the upload, so
  no partial object appears. `file-upload` passes the uploaded file to storage
  without copying it into a new buffer.
- Multipart uploads on the runtime `ObjectStore` contract:
  `createMultipartUpload`, `uploadPart`, `completeMultipartUpload`, and
  `abortMultipartUpload`, with `MIN_MULTIPART_PART_BYTES` (5 MiB),
  `MAX_MULTIPART_PARTS` (10,000), and `MultipartUploadError` codes
  `UPLOAD_NOT_FOUND`, `INVALID_PART`, and `PART_TOO_SMALL` that both providers
  report the same way. The S3 provider signs these requests with AWS Signature
  Version 4, because Bun's S3 client has no multipart calls, and works with AWS
  S3 and Silo/MinIO. The local provider keeps parts under
  `.podokit/multipart/` and removes uploads idle longer than
  `LOCAL_STORAGE_MULTIPART_MAX_AGE` seconds (default 86400). Applications that
  wrote their own S3 multipart writer can use these instead.
- `@podosoft/podokit-api-client` sends a `Blob`, `ArrayBuffer`, typed array, or
  `ReadableStream` request body as it is (a stream with `duplex: "half"`), and
  every call takes `{ contentType, headers, signal }`. JSON and `FormData`
  bodies behave as before. `ApiError.retryAfterSeconds` holds the
  `Retry-After` delay of a `429` or `503`. Applications that used a raw
  `fetch` to send binary upload chunks can use the client.
- Rate-limit route profiles. The `RATE_LIMIT_ROUTES` service (a runtime
  service key, re-exported by the rate-limit module) lets a module or the
  application give a path prefix, optionally for one method, its own request
  budget or exempt it. The most specific prefix wins, and the built-in general,
  authentication, and runtime budgets are registered the same way, so a longer
  prefix inside `/api/auth` takes precedence over the authentication budget.
  Upload chunks no longer have to fit the general budget, and applications
  that waited out `Retry-After` between chunks can register an upload budget
  instead.
- Resumable chunked uploads in the `file-upload` module. `POST /files/uploads`
  starts a session and returns its part size and count, `PUT
  /files/uploads/{id}/parts/{n}` streams one `application/octet-stream` part
  of an exact `Content-Length` into an object storage multipart upload,
  `GET /files/uploads/{id}` lists the stored parts for resuming, `POST
  .../complete` assembles the file, and `DELETE` cancels it. Sessions live in
  two new tables (`file_upload_sessions`, `file_upload_parts`; run
  `migration:run`), every transition is a conditional `UPDATE`, and a periodic
  sweep aborts expired uploads, so any number of API replicas can serve one
  upload and only one completes or aborts it. Other users receive 404. POST
  bodies must be JSON and parts binary (415 `UNSUPPORTED_MEDIA_TYPE`
  otherwise), so cross-origin browser calls always need a CORS preflight, and
  a browser `Origin` outside `CORS_ORIGIN` receives 403. Part uploads get their
  own `file-uploads` rate-limit budget. `FILE_UPLOAD_MAX_BYTES`,
  `FILE_UPLOAD_PART_BYTES`, `FILE_UPLOAD_SESSION_TTL`,
  `FILE_UPLOAD_SWEEP_INTERVAL`, and `FILE_UPLOAD_RATE_LIMIT_MAX` configure it.
  The module ships `$lib/uploads` for the browser: `uploadFile` and
  `resumeUpload` send parts three at a time, retry failures with backoff that
  honors `Retry-After`, report progress in bytes as the browser sends them
  (parts go out with `XMLHttpRequest`, and the value never decreases when a
  part is retried), and cancel the upload when their signal aborts. A 40 MiB upload to Silo through the API added about 47 MiB of
  API memory. Parts exceed the web `BODY_SIZE_LIMIT`, so the module declares
  `/api/files/uploads/` as a direct API path.
- Modules declare the direct API paths their routes need with `apiPaths` in
  `module.manifest.json` (manifest v4), validated like `exposure.apiPaths`.
  `podo add` appends them to `.podokit/dev.json` and to `exposure.apiPaths` in
  every deployment profile and prints what it added, keeping every other key
  and the file's indentation. A path an entry already covers is left alone, and
  one that would overlap another entry, cover a WebSocket path, or land in a
  profile that cannot route it (Kubernetes `nodePort` exposure) is reported
  instead of written. `.podokit/manifest.json` records them as the module's
  `appliedApiPaths`, `podo deploy init` copies them into new profiles, `podo
  remove` deletes the ones no other installed module declares, and `podo
  update` lists the paths a newer module version declares under "Direct API
  paths to add" and writes them with `--apply`. `file-upload` declares
  `/api/files/uploads/`, so its parts no longer need a manual configuration
  step.
  honors `Retry-After`, report progress, and cancel the upload when their
  signal aborts. A 40 MiB upload to Silo through the API added about 47 MiB of
  API memory. Parts exceed the web `BODY_SIZE_LIMIT`, so list
  `/api/files/uploads/` in `exposure.apiPaths` and `.podokit/dev.json`
  `apiPaths`.
- `services.supervise(name, connection)` in the generated API's service
  registry keeps a connection to another service open. Startup makes one
  attempt and then listens, and the registry reconnects in the background with
  backoff from 250 ms up to 5 seconds, also after `connection.onLost` reports a
  drop. It logs once when a dependency becomes unavailable and once when it is
  restored. `services.onStart` stays for work that must finish before the
  server listens.
- `EventBus.onInterruption(listener)`, an optional member of the runtime
  contract, reports that delivery resumed after an outage in which events may
  have been lost, and `EventBus.subscribe` is documented to register handlers
  without waiting for the transport. The `sse` module sends one `resync` to
  every open stream when its transport reports an interruption, so clients
  reload the state they missed while the stream stayed open.


### Changed

- The S3 provider rejects object keys with `.` or `..` segments for writes,
  because the request URL would resolve them to another key, and keys over
  1024 bytes. It also reads `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and a
  session token (`S3_SESSION_TOKEN` or `AWS_SESSION_TOKEN`) as Bun's S3 client
  does. `StorageService.put` accepts any object body and resolves with the
  number of bytes written.

- Generated apps commit `.env.docker.example`, with development defaults and an
  empty `BETTER_AUTH_SECRET`, instead of generating an ignored `.env.docker`.
  Every `podo dev` command except `url` creates the untracked `.env.docker` from
  the example when it is missing and fills each empty `*_SECRET` value with a
  random one. An existing `.env.docker` is never changed. `podo update --apply`
  adds the example and its `.gitignore` exception to existing apps; copy shared,
  non-secret values from your `.env.docker` into it.

### Upgrade notes

- Apps that already have the `file-upload` module get `/api/files/uploads/` in
  `.podokit/dev.json` and every deployment profile from `podo update --apply`.
  Review the "Direct API paths to add" section of the plan first.
- `RedisService` no longer takes a `ReadinessService` or registers the `redis`
  readiness check; the `redis` module registers it with `redis.ping()`. Code
  that constructs a `RedisService` itself registers its own check and passes
  the service to `services.supervise`.

- If you added header names to `FORWARDED_HEADERS` or `RELAYED_RESPONSE_HEADERS`
  in `apps/web/src/lib/server/backend-proxy.ts`, `podo update` merges the new
  proxy below your lists without a conflict and keeps your names working. Then
  move them to `APP_FORWARDED_REQUEST_HEADERS` and `APP_RELAYED_RESPONSE_HEADERS`
  in `apps/web/src/lib/server/proxy-headers.ts` and restore the managed lists, so
  later updates stay clean.
- The auth module's `./auth/skip-schema-validation` and `./auth/schema-validation`
  are now `./auth/maintenance-command` and `./auth/maintenance`. A script of your
  own that imported the first one to run against the auth database imports
  `./auth/maintenance-command` instead, which also lifts `DB_QUERY_TIMEOUT_MS`
  for its process.

### Fixed

- `HEAD` requests to routes registered as public for `GET`, such as
  `/profile-images/:fileName` and `/site/favicon`, answered `401`, because the
  access policy matched rules by exact method. A `HEAD` request now matches `GET`
  rules too, unless a `HEAD` rule was registered after them, and Elysia answers
  it with the GET handler, so it gets the GET response's headers, including
  `content-length` and `etag`, without the body, and `304` for a matching
  `If-None-Match`. Other methods are unchanged.

- Responses relayed by the web app's `/api` proxy lost their `Content-Length`
  above a few KiB, because Bun sends a streamed body, a `fetch()` response body
  included, with chunked encoding. The proxy now reads an uncompressed body of up
  to 2 MiB with a known length before relaying it, so images and JSON responses
  reach the browser with their length; larger bodies still stream through.

- Objects up to 2 MiB served from the S3 provider, such as profile images and
  favicons, lost their `Content-Length`: `objectResponse` set it, but Bun sends
  a streamed body with chunked encoding unless the body is in memory or a file.
  `StorageService.open()`, behind `OBJECT_STORAGE.get()`, now sends one GET
  instead of a HEAD and a later GET, takes the metadata from that response, and
  reads objects up to 2 MiB into memory before it resolves. Larger objects still
  stream from the GET and go out chunked; their GET stays open until the body is
  read or cancelled. A missing bucket now throws instead of being reported as a
  missing object.

- Objects served from the local storage provider lost their `Content-Length`
  for the same reason: `LocalObjectStore` streamed every file through a
  JavaScript `ReadableStream`. `get()` now reads objects up to 2 MiB whole, with
  the same checks that the path still holds the described file, before it
  resolves, and returns them as an in-memory body; a file replaced during that
  read is described again. Larger objects still stream in 64 KiB chunks from the
  first read and go out chunked. The runtime exports the 2 MiB limit as
  `IN_MEMORY_READ_BYTES`, which the S3 provider uses too.

- Requests that enqueue a BullMQ job no longer hang while Redis is down. The
  API's queues shared the workers' connection settings, whose
  `maxRetriesPerRequest: null` makes a command wait for Redis indefinitely, so
  `POST /jobs` and `POST /progress` waited until Redis returned. The API
  now adds and reads jobs over one producer connection that fails at once while
  disconnected and after `REDIS_COMMAND_TIMEOUT_MS` without a reply, answering
  `503` `JOBS_UNAVAILABLE` with `Retry-After`. The service registry supervises
  that connection, so the API starts while Redis is down, and the new `jobs`
  readiness check reports it. Workers keep their blocking connections and now
  reconnect with backoff from 250 ms up to 5 seconds instead of up to 20
  seconds. The module requires BullMQ 5.57 or later.

- Redis commands no longer hang while Redis keeps the connection open without
  answering, as a paused container does. `RedisService` and the Redis `CACHE`
  store had no reply timeout, so cache reads and writes waited indefinitely,
  and the connection still looked open, so neither readiness nor the
  supervisor noticed. Each command now fails after `REDIS_COMMAND_TIMEOUT_MS`
  (default `1000`) with `RedisCommandTimeoutError`, and the connection is
  closed, which fails the commands queued behind it, and reopened in the
  background. The `events-redis` transport bounds publishing and its channel
  subscription the same way, and the demo `/cache` endpoints answer `503`
  `CACHE_UNAVAILABLE` instead of `500` while Redis cannot be reached. Run
  commands that `RedisService` does not wrap through `redis.command(...)` to
  bound them too.

- Queries on the API's Bun SQL pool no longer hang while PostgreSQL keeps its
  connections open without answering, as a paused container, a frozen VM, or a
  network partition does. Bun SQL has no query timeout, `query.cancel()` does
  not stop a running query, and a single pool connection cannot be closed, so
  such a query waited until the server answered again and kept its connection.
  The pool now watches every query and transaction: one still pending after
  `DB_QUERY_TIMEOUT_MS` (default `10000`) makes the API check whether
  PostgreSQL answers `SELECT 1` on a new connection within
  `READINESS_CHECK_TIMEOUT_MS`. When it does not, the API opens a new pool and
  closes the stalled one, so the waiting requests answer `503`
  `DATABASE_UNAVAILABLE`, the supervisor logs the outage, and queries succeed
  again once the server answers. Slow queries on a server that answers keep
  running, and migrations are not affected.

- An auth request no longer waits for a configuration refresh that PostgreSQL
  does not answer. Before Better Auth runs, each request may check whether the
  auth settings changed; during an outage that check waited as long as a query
  may wait, so a sign-in answered `503` only after two timeouts. The request now
  waits for it at most `READINESS_CHECK_TIMEOUT_MS`, and the current
  configuration serves it while the check finishes in the background.

- Better Auth endpoints no longer hang while PostgreSQL keeps its connections
  open without answering. The auth module's `pg` pool had no query timeout, so
  `POST /api/auth/sign-in/email` and `GET /api/auth/get-session` waited for
  the server, and pg's own `query_timeout` alone would not help: Kysely, which
  Better Auth runs on, returns a timed-out connection to the pool, where every
  later query queues behind the missing reply. The pool now fails a query after
  `DB_QUERY_TIMEOUT_MS` and discards a connection that is released while it
  still waits for a reply, so the endpoint answers `503` `DATABASE_UNAVAILABLE`
  and the next query opens a new connection. The migration runner and
  `admin:bootstrap` run without the timeout: `./auth/maintenance-command`,
  which replaces `./auth/skip-schema-validation`, marks their process.

- Better Auth endpoints answer `503` with `DATABASE_UNAVAILABLE` while
  PostgreSQL is unreachable. `POST /api/auth/sign-in/email`,
  `GET /api/auth/get-session` with a session, and every route that needs a
  session answered `500`, because Better Auth turns a failed query into a bare
  `500` and its session lookup drops the cause. After such a server error the
  auth module now runs `SELECT 1` on its pool, bounded by
  `READINESS_CHECK_TIMEOUT_MS`, and answers `503` only when that fails as well;
  client errors such as `401` and unrelated `500` errors are unchanged. Every
  `503` error envelope now carries `Retry-After: 1` unless the failing code set
  its own value, so `DATABASE_UNAVAILABLE` tells clients when to retry as
  `RATE_LIMIT_UNAVAILABLE` already did.

- The `events-redis` transport starts while Redis is down and keeps delivering
  across replicas after Redis restarts. Startup waited on its connection, logged
  `Settings change events are unavailable; replicas converge on the settings
  TTL`, and then failed. When Redis restarted under a running API, Bun
  reconnected without the channel subscription, and stopped reconnecting after
  about 30 seconds of outage, so SSE events and settings change events from
  other replicas silently stopped arriving. Handlers are now registered locally
  without waiting for Redis, the
  registry reconnects the transport in the background, and the channel is
  subscribed again on a fresh connection after every drop. Open SSE streams
  receive `resync` once delivery resumes, and the `events` readiness check
  reports the transport down until it is subscribed.

- The `redis` module no longer stops the API from starting while Redis is down,
  and it recovers from a Redis restart without restarting the API. The client
  gave up after its first failed reconnect, so the API exited at startup with
  `RedisError: Connection closed`, and a running API whose Redis was stopped
  for ten seconds kept failing readiness and answering `RATE_LIMIT_UNAVAILABLE`
  until the API itself was restarted. Commands now fail at
  once while disconnected, the registry reconnects in the background, and
  `RedisService.subscribe` subscriptions are restored after every reconnect;
  Bun keeps their listeners but not the server subscription.

- The generated API starts and listens while PostgreSQL is unreachable, answers
  `/health/ready` with 503 until the database is back, and becomes ready without
  a restart. It used to exit at startup with `ERR_POSTGRES_CONNECTION_REFUSED`,
  so Kubernetes restarted it in a loop. The `jobs-local` worker likewise
  creates its table once the database is reachable instead of failing startup.
  The `/health/ready` 503 message now names the checks that are down, such as
  `One or more dependencies are unavailable: db`.

- The admin-dashboard `disposableUsers` Playwright fixture cleans up through its
  own request context in UI tests, holding a copy of the browser's admin cookies
  taken when the test starts. A UI test that signed its page in as another user
  used to turn cleanup into that user's requests, which failed with 403.
- `@podosoft/podokit-api-client` reports an error response whose body is not
  JSON, such as a gateway's 502 page or a web server's plain-text 413, as an
  `ApiError` with `HTTP_ERROR`, its status, and `retryAfterSeconds`. It threw a
  `SyntaxError` from parsing the body, so callers could not tell the status or
  retry.

- `podo dev` with more than one `webSocketPaths` entry rendered a Traefik
  `Path` matcher with several values, which Traefik v3 rejects, so none of the
  WebSocket paths reached the API. Each path now has its own matcher.
- The admin-dashboard `hooks.server.ts` loads the session and site settings for
  SvelteKit's 404 page, which renders the root layout. It skipped them for every
  unmatched path, so a signed-in visitor on a missing page was sent to
  `/login`, which sent them back. A missing image, script, or other subresource
  still skips both calls, and so does prerendering, where the API is not
  running. Files in `static/` and prerendered pages never reach the hook.
- `podo dev up` rebuilds the development images from the current source by
  passing `--build` to `docker compose up`; `--no-build` keeps the old
  behaviour. Compose Watch syncs edits into running containers only, so a
  container that `up` recreated, for example after a memory limit or
  `.env.docker` change while `podo dev watch` was running, started from the
  last built image and lost every synced edit.
- `podo dev down` stops the `podo dev watch` of the same project before it
  removes the stack. The watch kept running and held Compose's per-project
  lock, so the next `podo dev watch` failed with "cannot take exclusive lock"
  until someone killed it by hand. Other projects' watches and the shared
  gateway are untouched, and the stopped watch exits without an error.
- A fresh clone of a generated app can start its containers. Git ignored the
  generated `.env.docker`, so `podo dev` failed with "env file .env.docker not
  found" until someone recreated it by hand.
- `bunx --bun shadcn-svelte@latest add <component>` works in a generated app.
  `components.json` lacked the `hooks` and `lib` aliases, so the CLI stopped
  with an invalid alias error, and its `utils` alias ended in `.js`, so
  vendored files imported `#lib/utils.js.js`.

## [1.3.0] - 2026-10-15

### Added

- `SSE_MAX_STREAMS_PER_USER` (default 8) caps the event streams one user holds on
  each API replica. Another stream answers 429 `EVENTS_STREAM_LIMIT`.
- The `IndexSessionCreatedAt` migration (admin-dashboard) indexes
  `session ("createdAt", "id")`, the order of the admin session list, so a page
  no longer sorts the whole session table. PostgreSQL builds it concurrently.
- `GET /admin/users` (admin-only) lists users with offset paging, sorting, a
  case-insensitive search, and `role` and `status` (`active`, `pending`,
  `banned`) filters that combine. The admin users page uses it, so Role and
  Status no longer replace each other and the *Active* status is back.
  Mutations still go through Better Auth.
- `apps/web/src/lib/server/public-paths.ts` (admin-dashboard) is an
  application-owned `APP_PUBLIC_PATHS` list that the managed `guards.ts`
  includes, so an app's own public pages render without a session and stay up
  when the API or site settings are unavailable. `podo update` creates it once
  in existing apps and never overwrites it.

### Deprecated

- `listUsersQuery` and `keepLatestFilter` in `#lib/admin/users.ts`. They remain
  for users pages generated by 1.2, which are application-owned; use
  `adminUsersQuery` and `listAdminUsers`.

### Fixed

- `podo update` adds the module that implements the project's selected provider
  when an installed module gains a capability requirement, and lists it under
  "Modules to add". In 1.2.0 `sse` requires `events`, so an app updated from an
  earlier release without an events provider started with "Required service is
  not registered". Update also moves a provider recorded after the modules that
  use it in front of them, because modules configure in manifest order.
- `podo add` places a newly added provider ahead of installed modules that
  require it: in `.podokit/manifest.json`, in marker wiring such as the
  `apps/api/src/app.ts` module list, and in `.env.example`.
- Template dependency ranges for PodoKit packages now name the current
  versions. The web template requires `@podosoft/podokit-api-client` `^0.8.5`,
  whose contracts provide `Capabilities.require2fa`; an app that kept an older
  lockfile entry failed `svelte-check`.
- `admin:bootstrap` imported modules the API build never emitted. It now loads
  the bundled `dist/bootstrap-admin-runtime.js` under `NODE_ENV=production` and
  the source otherwise, on PostgreSQL and SQLite. When it cannot reach the
  database it prints each cause instead of an empty line.
- The `IndexAuditLogFilters` migration builds and drops its PostgreSQL indexes
  with `CONCURRENTLY` outside a transaction, so audit writes continue while it
  runs, and rebuilds an index left invalid by an interrupted build. TypeORM
  migrations use `migrationsTransactionMode: "each"`. SQLite is unchanged.
- The auth configuration service returns `enabled` as a boolean on SQLite
  instead of `0` or `1`.
- Changing the session idle timeout on SQLite no longer fails with a syntax
  error. Active sessions get the new lifetime as ISO 8601 text, the format
  Better Auth stores on SQLite.
- The request budget, OIDC consent, user row menu, and password reset UI specs
  wait for hydration or read each response before navigating on, so they pass
  on slower development servers.
- Blog module 1.0.3: the public list and comments stay up with an
  "unavailable" message during an API outage, a missing post answers 404
  instead of 500, a post page answers a retryable 503 during an outage, and
  `/blog/mine` returns 503 instead of a sign-in redirect while sessions cannot
  be checked.
- Generated Playwright specs and helpers pass strict type checking;
  `playwright.extensions.ts` now types projects with `PlaywrightTestConfig`.

### Upgrade notes

- Run `podo update` with this version and review the plan. An app that has
  `sse` (or `job-progress`) but no events provider shows the provider under
  "Modules to add"; `podo update --apply` installs it ahead of its dependents.
  An app where `podo add events-redis` already appended the provider after
  `sse` gets a clean update of `apps/api/src/app.ts` that restores the order.
  The same applies to `cache`, `object-storage`, and `jobs` providers.
- After `podo update --apply`, run `bun install` so the lockfile picks up the
  raised `@podosoft/podokit-api-client` range.
- Apps that already applied `IndexAuditLogFilters1792000000000` are unaffected;
  the migration does not run again. Custom TypeORM migrations now each run in
  their own transaction rather than all pending migrations in one.
- Run `bun run --cwd apps/api migrate:all` after the update to build the admin
  session list index.
- A user with more than eight tabs streaming events from one replica now gets
  429 `EVENTS_STREAM_LIMIT` for the extra streams; `$lib/events` retries them
  with backoff. Raise `SSE_MAX_STREAMS_PER_USER` if your users need more.
- Move public pages you added to the `PUBLIC_PATHS` list in `guards.ts` into
  `APP_PUBLIC_PATHS` in `apps/web/src/lib/server/public-paths.ts` before
  updating. If you already import `./public-paths` and spread it right after
  `"/maintenance"`, update merges your edit without a conflict and keeps your
  file.
- Blog route wrappers are application-owned. After `bun update
  @podosoft/podokit-module-blog` and `podo update --apply`, the managed loaders
  already answer 404 and keep the list up; add `requireBackendAvailable` to your
  `/blog/mine` loader and show `posts.unavailable` as described in the blog
  README.
- `/admin/users/+page.svelte` is application-owned, so update keeps your page,
  which still uses Better Auth `listUsers` with one filter. Compare it with the
  template page to adopt `GET /admin/users`.
- If your app worked around `admin:bootstrap` with its own bundled entry,
  revert that workaround (the entry file, its `scripts/build.mjs` target, and
  the script edit) before `podo update`, so update installs the generated
  `src/bootstrap-admin-runtime.ts` without conflicts.

## [1.2.0] - 2026-10-15

### Added

- `AUDIT_LOG_RETENTION_DAYS` prunes audit entries older than the given number of
  days in batches. It is off by default; enable it only where retention policy
  allows deleting audit history.
- `GET /audit-logs` pages with an opaque `X-Next-Cursor` header and filters by
  `action`, `actor` (email), and `target` (label) on the server.
  `GET /audit-logs/actions` lists the recorded action codes.
- `recordAuditLater()` defers non-security audit writes into a bounded queue that
  is written in batches and flushed on shutdown.
- `Capabilities.require2fa` reports the two-factor policy, so the protected
  layout no longer calls `/account/require-2fa`. The endpoint stays.
- `DB_POOL_MAX`, `DB_AUTH_POOL_MAX`, `DB_CONNECT_TIMEOUT_MS`, and
  `DB_IDLE_TIMEOUT_MS` configure the API's PostgreSQL pools. A request that
  cannot get a connection in time answers 503 `DATABASE_UNAVAILABLE` instead of
  waiting forever. See [Providers](docs/providers.md) for the per-replica budget.
- `READINESS_CHECK_TIMEOUT_MS` and `READINESS_CACHE_MS` bound each readiness
  check and share one result between concurrent probes.
- Every service in the container dev stack has a memory limit equal to its swap
  limit, adjustable with `*_MEM_LIMIT` in the shell or `.env`.
- `$lib/events` (with the `sse` module) shares one `EventSource` per tab:
  `subscribe(topic, handler)` reconnects with backoff and tells subscribers to
  reload with `{ resync: true, topic }` after a server resync or a reconnect.
- Event streams take `?topics=a,b`, and modules restrict a topic or prefix with
  `events.topics.register()`. Events carry an optional audience of `userIds`,
  `roles`, and `organizationId`.
- `RequestIdentity` has `roles()` and `activeOrganizationId()`. The auth module
  answers them from the session it already loaded for the request.
- `GET /admin/sessions` (admin-only) lists active sessions with keyset paging and
  an email-or-name search, without tokens. `DELETE /admin/sessions/{id}` revokes
  one through Better Auth, so the permission check and the audit hook still run.
- `@podosoft/podokit-runtime`: `ObjectStore.stat()`, paged
  `ObjectStore.list(prefix, { cursor, limit })`, and `objectResponse()`, which
  serves an object with `content-length`, `ETag`, and `Last-Modified` and answers
  a matching `If-None-Match` with 304 without reading the object.

### Changed

- The settings store runs one version probe per tick instead of reading every
  settings row, reloads only when a table changes (deletes included), and
  refreshes `SettingsService` on every replica. With an events provider
  installed, a settings write invalidates other replicas immediately.
- The admin audit page pages and filters on the server. Apps created earlier own
  `routes/(admin)/admin/audit/+page.svelte` and keep showing only the latest 50
  entries until they take the new page.
- `AuditService` takes `{ dialect, enabled }`, `close()` is async, and `recent()`
  is replaced by `list()`.
- Session reads no longer set the `set-auth-jwt` header. Clients that need a
  JWT call `GET /api/auth/token`.
- Bearer authentication accepts only signed session values (the
  `set-auth-token` header or the cookie value). An unsigned token answers 401.
- Rate limiting counts per signed session instead of per user, in the order API
  key, verified session cookie or bearer, then client IP. It no longer reads the
  session from the database.
- Client navigation no longer carries the message catalog in `__data.json`.
  New apps load messages in a universal root `+layout.ts`. Apps created earlier
  own `routes/+layout.server.ts`: stop returning `messages` from it after the
  update adds `+layout.ts`, and use `getCapabilities(event)` for capabilities.
- Demo storage routes (`PUT`/`GET /storage/:key`) require an administrator and
  only address keys under `demo/`.
- Uploads are stored as `uploads/<userId>/…` and only their uploader or an
  administrator can presign them. Uploads stored before this change can be
  presigned by administrators only.
- Local-storage downloads require a signed URL. Only script-free types render
  inline; everything else downloads, with `nosniff` and a sandbox policy.
- `ObjectStore.get()` returns the object's size, content type, entity tag, and
  modification time with a `ReadableStream` body that opens on the first read,
  or `null`. Custom object stores must implement `stat()` and `list()`. The S3
  store downloads through a presigned `GET` pinned with `If-Match`, so a slow
  client no longer makes the API buffer the object.
- Favicon and profile-image routes stream from storage with validators instead
  of copying each object into memory. A favicon requested with the current
  `?v=` is cached as immutable for a year; other requests revalidate. A storage
  failure is reported as an error instead of a missing image.
- The admin-only demo `GET /storage/:key` returns the object's bytes with its
  validators instead of `{ key, content }`.
- The admin users page reads one page per page, sort, or search from Better Auth
  instead of loading up to 500 users, and the admin sessions page reads
  `GET /admin/sessions` instead of one request per user. Better Auth accepts one
  filter, so the Role and Status filters replace each other. Apps created
  earlier own `routes/(admin)/admin/users/+page.svelte` and
  `routes/(admin)/admin/sessions/+page.svelte`; take the new pages from a freshly
  generated app to get server paging. See [Modules](docs/modules.md).
- The `rate-limit` module counts admin reads (`GET /api/auth/admin/*`) against
  the general budget. Admin writes and other authentication routes keep the
  strict budget.
- The 2FA QR code library loads only when enrolment starts. Apps created
  earlier own `routes/setup-2fa/+page.svelte` and can import `qrcode` inside the
  effect that renders it in the same way.
- Session idle-timeout tracking keeps activity in plain variables, writes
  `localStorage` at most every five seconds, and schedules one deadline timer
  instead of reacting to every scroll and keypress.
- Each SSE data event's `data` is `{ topic, data }`, heartbeats are SSE comments,
  and a stream ends after 30 minutes so the client re-authenticates.
  `EventsService.publish()` takes `{ topic, audience?, data, id? }`, and
  `EventsService.subscribe()` was removed. See "Upgrading from the open broadcast
  stream" in [Modules](docs/modules.md).

### Fixed

- Auth settings (OAuth providers, SMTP, server toggles) save on SQLite apps;
  Bun's SQLite driver rejected the object parameter.
- The audit toggle applies to every write, not only request and auth hooks.
- Audit metadata is stored as a JSON object in PostgreSQL and as JSON text in
  SQLite. SQLite rows written before stored `0` and cannot be recovered.
- OAuth consent sends the signed authorization query, so allowing consent no
  longer fails with `missing oauth query`. Apps created earlier own
  `routes/oauth2/consent/+page.svelte`; send
  `oauth_query: signedOAuthQuery(page.url.search)` from `$lib/oauth-query`.
- `/site/settings` answers from one query shared for three seconds instead of
  three sequential queries, and site settings writes are visible on the next
  read.
- The merged OpenAPI document is generated once per auth configuration, and the
  rate-limit script runs by SHA.
- Readiness re-checks the database on every probe again. Since 1.1.2 it checked
  once at startup, so an outage after boot stayed `ready`.
- The web proxy aborts the upstream API request when the client disconnects, so
  closed event streams no longer hold API sockets.
- The web proxy forwards encoded `/` and `?` in a path segment unchanged. Apps
  created earlier own `routes/api/[...path]/+server.ts` and
  `routes/api/auth/[...all]/+server.ts`; update them to build the upstream path
  with `rawSubpath(url, "/api/")` and `rawSubpath(url, "/api/auth/")`.
- The proxy relays `etag`, `last-modified`, `content-disposition`, `vary`, and
  range headers, and relays `content-length` only for uncompressed responses.
- Kubernetes API probes allow two seconds instead of the one-second default.
- Any signed-in user could call `POST /events` and push a message to every open
  stream. It now requires an administrator; publish from server code with
  `EventsService`.
- Every stream received every event, including other users' and organizations'
  identifiers. Streams require a signed-in user and receive only the topics and
  audiences they may read.
- Job progress was broadcast to every stream. `POST /progress` records the caller
  as the job owner and progress reaches only that user. Jobs enqueued before the
  update have no owner and publish nothing.
- SSE connections buffer at most 256 events; a client that falls further behind
  gets one `resync` event instead of growing the queue without limit. A closed
  stream releases its subscription and timer at once.
- The admin sessions page spent one strict authentication request per user, so
  above about 19 users it hit 429 and sessions silently disappeared, and session
  tokens reached the browser.
- A local object store that was never used could crash the process with an
  unhandled rejection when its directory went away. The root is now prepared on
  first use, and a failed attempt is retried.

## [1.1.6] - 2026-10-10

### Fixed

- Skip Better Auth's startup schema check in the generated migration runner, so
  `migrate:all` no longer logs a schema mismatch for the schema it is about to
  migrate. API servers keep validating the schema at startup.

## Released package history

Changesets records released versions and dependency changes in each package's
changelog. Use these for the Bun/Elysia v1 release line:

- [CLI and generated templates](packages/cli/CHANGELOG.md)
- [Runtime providers](packages/runtime/CHANGELOG.md)
- [Authentication primitives](packages/podokit-auth/CHANGELOG.md)
- [Template engine](packages/template-engine/CHANGELOG.md)
- [API client](packages/api-client/CHANGELOG.md)
- [MCP server](packages/mcp/CHANGELOG.md)
- [Blog module](packages/podokit-module-blog/CHANGELOG.md)
- [Analytics module](packages/podokit-module-analytics/CHANGELOG.md)

## Historical 0.x development notes

The following notes were previously grouped under `Unreleased` while 0.x
features accumulated. They are preserved as historical context, not pending v1
changes. In particular, Node/NestJS defaults and runtime conversion describe the
earlier architecture. Current v1 applications use Bun and Elysia exclusively;
see [Updating](docs/updating.md) for the compatibility boundary.

### Added
- **Node and Bun runtime profiles.** `podo create --runtime bun` now generates a
  Bun 1.4.0-native workspace with Bun lockfiles, scripts, Docker images, Compose,
  release CI, and tests while keeping Node/npm as the default and pnpm/yarn as
  Node-compatible choices. `podo runtime set node|bun` previews and atomically
  applies runtime conversion with version checks, dependency audit, build,
  lint, tests, 3-way merge protection, and rollback on failure. Manifest schema
  v3 records the selected toolchain, and CI verifies a Node→Bun→Node round trip.
  The MCP `create_project` tool and generated MCP configuration select the same
  runtime profile. Bun containers use the pinned Alpine image and production
  images install only the target app workspace. Conversion resolves the target
  lockfile from its manifest instead of importing stale resolutions from the
  previous package manager.
- **Guarded Kubernetes deployment and distributed runtime primitives.**
  `podo deploy` now initializes secret-free profiles, validates an explicit
  cluster fingerprint, renders module-aware Helm resources, hashes plans, runs
  migrations with the exact API image, and requires the matching confirmation
  hash for apply or rollback. Generated agent skills and read-only MCP tools
  expose the same profile, doctor, plan, status, and verification contract
  without permitting remote cluster mutations. Verification origins reject
  embedded URL credentials before they can enter plans or tool output.
  Apply and rollback now hold a release-scoped Kubernetes Lease, reject
  malformed successful Helm or Kubernetes responses, and roll workloads when
  referenced Secret identities or runtime ConfigMap content changes.
  Redis-backed SSE provides
  cross-replica event delivery with readiness checks, authenticated Redis
  settings are shared by queues and rate limiting. Rate-limit identities prefer
  authenticated users, then validated API keys, then an application-provided
  `RateLimitIdentityExtension`, then an explicitly trusted proxy address; stable
  429 and bounded Redis-failure 503 responses include `Retry-After`. The
  extension keeps one managed global guard, and `podo add --adopt` can explicitly
  bring existing Redis and rate-limit implementations under module management.
  Generated k3s ingress
  sends all public traffic through the SvelteKit proxy.
- **Module baseline prerequisites.** Modules can require generated-project
  baseline files and stable source contracts, then fail before mutation with an
  update instruction. This prevents newer Redis, SSE, queue, and storage
  overlays from creating broken imports or incompatible option types in older
  projects.
- **External analytics module.** New
  `@podosoft/podokit-module-analytics` package adds provider-neutral page and
  application event collection with GA4 as the first provider, advanced Consent
  Mode v2, encrypted administrator configuration, traffic and key-event reports,
  and realtime visitors. The generated runtime excludes sensitive routes and
  never sends account identifiers, while a new `SiteRuntime` injection seam
  lets optional modules install browser-wide behavior without editing an
  application-owned root layout. A scrollable in-product guide explains how to
  issue GA4 credentials from the official Google Analytics and Google Cloud
  consoles. The faithful generated-app Outer path publishes and installs the
  external package so release gates cover its shipped output.
- **Extensible mobile and product-shell UI primitives.** Generated applications
  can add owned Playwright browser/device projects without editing the managed
  config, render the shared account menu with visible identity outside the admin
  sidebar, and keep responsive DataTable headers and cells aligned with shared
  breakpoint classes.
- **Admin-only route-group separation and safe module path migrations.**
  `admin-dashboard` now reserves `(admin)` and `admin-sidebar.svelte` for the
  admin-only `/admin/*` console while leaving the protected, shell-free `(app)`
  group for product pages. Manifest v2 migrations let `podo update` move generated files
  and whole route trees without dropping application-owned admin pages, with an
  atomic collision preflight, exact text rewrites, lock/glob remapping, and
  idempotent application records. The external blog module follows the new
  admin route path, and generated agent plus MCP guidance explains the boundary.
- **Shared portless development gateway.** `podo dev watch|exec|logs|ps|down|url`
  runs generated stacks behind one user-level, socket-free Traefik gateway on
  loopback port 80. Each project owns a stable `*.localhost` hostname through
  `.podokit/dev.json`, hostname collisions fail early, and the final `down`
  removes the shared gateway. Installed modules now activate their required
  `cache`, `storage`, and `queue` Compose profiles automatically. Vite HMR
  derives its endpoint from the browser
  origin, so the same app works through a stable HTTPS tunnel without a special
  OAuth port. Provider-neutral guidance covers Cloudflare Named Tunnels, reserved
  ngrok domains, callback access bypasses, and separate provider clients per tier.
  Root, CLI, getting-started, template, and generated test guides document the
  single-project lifecycle, multi-project reuse, host-process alternative, and
  portless Playwright origin; generation tests keep both fullstack READMEs aligned.
- **Idempotent initial administrator bootstrap.** Generated admin applications
  include `admin:bootstrap`, a database-backed command that creates a verified,
  approved administrator from `ADMIN_EMAILS` after migrations. Dry-run and
  check-only modes are read-only, repeated execution verifies the existing role
  and password, and credentials remain ephemeral and redacted. Public setup docs
  and the generated auth configuration skill now use this command instead of
  relying on browser sign-up.
- **Multi-app module package overlays.** Module manifests can declare
  `packageOverlays.<app>` when a feature needs dependencies or scripts in a
  workspace app other than its primary `targetApp`. Add, update, and remove now
  apply those package declarations symmetrically.
- **Update-managed module workflows inside owned AI guidance.** Module manifests
  can declare `managedOverrides` for generated skills that must continue to
  receive safe 3-way updates even though `.claude/**` is user-owned by default.
  Existing unchanged skills migrate from owned to managed on update, while an
  explicit file-level eject still takes precedence.
- **Generated API runtime images include operator scripts.** Production images
  now copy `apps/api/scripts`, so generated commands such as `auth:configure`
  and `admin:bootstrap` can run inside the deployed API container after the
  compiled migration step. Compose watch also synchronizes these scripts into
  the API and worker development containers.
- **Provider-independent sign-up approval and automated auth setup.** Generated
  auth/admin apps can require administrator approval for every self-registration
  path, block pending sessions with a stable error code, approve users from the
  shared Users table, and show configured social providers on the login page.
  The new `auth:configure` command and generated skill apply OAuth/SMTP settings
  without exposing secrets and cover Google now while keeping Apple rotation and
  additional providers on the same workflow.
- **Compiled production database migration command.** Auth-enabled generated APIs
  include `npm run migrate:all`, which applies Better Auth and TypeORM migrations
  from `dist` for container and Kubernetes migration jobs without a runtime CLI
  download or TypeScript source tree.
- **Markdown image attachments for blogs.** Signed-in authors can upload PNG,
  JPEG, GIF, WebP, or AVIF images up to 5 MB directly from `BlogEditor`; the
  editor inserts Markdown at the current cursor. Images are served from a stable,
  immutable public blog path instead of an expiring object-storage URL, with API
  and UI coverage for upload, validation, preview, and published rendering.
- **External blog module.** New `@podosoft/podokit-module-blog` package provides
  authenticated Markdown publishing, paginated posts and comments, author-owned
  edit/delete flows, admin management, an additive legacy-compatible migration,
  reusable web helpers, and Playwright API/UI coverage. Public and admin route
  wrappers stay application-owned for design and SEO customization.
- **External modules now participate in updates.** Project manifests record the
  backing package and applied version; `podo update` resolves installed package
  modules from the consumer project, retains their root dependency, and refreshes
  the recorded module version after apply. `podo add --adopt` explicitly hands
  only module-declared managed paths back while preserving owned presentation.
- **Proxy response compression.** New fullstack and todo projects attach Traefik's
  compression middleware to the containerized development router and the k3s
  Ingress, reducing dynamic HTML and other compressible response payloads. The
  owned local Traefik file remains safe from update overwrites; existing apps can
  adopt that small template change explicitly.
- **Private route search protection (admin-dashboard).** Admin, account,
  authentication, maintenance, and API responses now include
  `X-Robots-Tag: noindex, nofollow`, while the public landing page remains
  indexable. Application-specific canonical URLs, sitemaps, robots rules, and
  structured data remain owned by each generated application.
- **User account page (admin-dashboard).** Every signed-in user can manage their
  profile and security at `/account`, while `/admin/account` remains available.
  A reusable avatar menu shows sign-in for guests, account controls for users,
  and the admin entry only for administrators.
- **Theme / Appearance settings (admin-dashboard).** A dedicated **Appearance**
  tab in admin Settings replaces the single "Brand color" field with a full theme:
  six frequently useful presets are shown as visual choices, while the complete
  21-preset catalog remains available under **Show more themes**. Quick settings
  cover the brand color and five practical corner styles; **Fine-tune colors**
  keeps independent light/dark token editing available without crowding the main
  form. A larger app-shell preview toggles between light and dark, and
  **Restore defaults** remains one click. Saving applies the theme across the whole app instantly
  via a mode-scoped stylesheet (`:root:not(.dark)` / `:root.dark`), so light and dark
  are tuned independently and dark is never disturbed by a light edit. New public
  site settings keys `themePreset`, `themeRadius`, `themeOverrides` (validated to
  prevent CSS injection); reuses the existing `brandColor`. New reusable modules
  `#lib/site/themes.js` and `#lib/site/apply-theme.js`. i18n (en/ko) and Playwright
  (ui + api) tests included. No DB migration (uses the existing `app_setting` store).

### Fixed
- **SvelteKit 3 source resolution and bundled web synchronization.** Generated
  web applications now declare `#lib/*` through package imports, include explicit
  file extensions, and limit type checking to source/config files so a completed
  production build is not rechecked as source. Compose artifact sync treats the
  official adapter output as a self-contained web payload while retaining runtime
  dependency drift protection for API and worker containers. Faithful local
  package verification also uses an isolated Bun cache so republishing the same
  development version cannot reuse stale external-module contents.
- **Stable analytics consent regression test.** The inherited browser test now
  resets consent once per page session instead of clearing it again on reload,
  so it verifies the persisted denied choice and settings control without a
  transient hydration race.
- **Complete module dependency updates.** `podo update` now expands the target
  version's module requirements and applies newly introduced dependencies before
  their dependants, preventing partial updates with generated imports that point
  to files an older project never installed.
- **Safe dependency detection during module add.** The project manifest is now
  authoritative for installed requirements, so adding an external module cannot
  re-overlay an existing customized dependency and erase other modules'
  registry or localization injections.
- **Complete external-module removal.** `podo remove` now reverses multi-line
  injection blocks and drops module-owned globs when no preserved edit or other
  module still needs them, preventing stale imports and ownership rules after an
  optional module is removed.
- **Repeatable inherited admin tests and relocated ejects.** Generated UI
  storage state now pins the English catalog used by accessible-name locators,
  so the suite does not inherit an application's configured default language.
  The setup creates its authentication-state directory on first use, and
  teardown exits cleanly when setup could not capture a baseline.
  Disposable-user fixtures reuse that authenticated context instead of creating
  another login that can revoke it under a single-session policy. Generated
  user management specs now remove every disposable user and build pagination
  from isolated data. `podo update` also preserves explicitly ejected files
  after an application moves or deletes the original path instead of restoring
  a conflicting generated route.
- **The General Settings language selector shows the application default.** An
  empty stored locale now resolves to the generated application's default locale
  instead of rendering a blank select trigger, and the form waits for the
  server-loaded site settings before taking its one-time editable snapshot.
- **New default-owned paths are promoted during update.** Existing applications
  now adopt newly declared PodoKit ownership defaults, so project-specific files
  such as `.podokit/dev.json` stay untouched instead of surfacing as conflicts.
- **Owned HTML defaults no longer override the selected locale on SSR.** The
  managed localization hook now replaces any existing `<html lang>` value, so
  an application that owns `app.html` and starts in Korean still preserves an
  English locale cookie across a server-rendered reload.
- **Development teardown removes optional profile services.** `podo dev down`
  now activates every Compose profile automatically, so Redis, MinIO, workers,
  tunnels, and other services started by an earlier watch command cannot keep
  the project network or stale containers alive.
- **Registration policy and authentication return paths are consistent.** Turning
  off public sign-up now blocks every new-user path, including OAuth callbacks,
  while preserving existing social logins and administrator-created users.
  Login and public-page logout return to a validated previous path instead of
  forcing `/admin`. Generated Google guidance documents stable HTTPS development
  callbacks through provider-neutral tunnels and separate clients per tier.
  Admin Settings and `auth:configure` now persist the exact callback instead
  of silently falling back to the application's default hostname; the
  `--redirect-only` mode repairs stale callbacks without reading or replacing
  stored provider credentials.
- **Readiness fails when PostgreSQL is unavailable.** Generated APIs now return
  HTTP 503 from `/health/ready` when the database probe fails, preventing
  Kubernetes and load balancers from routing traffic to an unready API pod.
- **Production images use the workspace lockfile.** Generated API and web
  Dockerfiles now use Node 22 and build from the repository root with `npm ci`,
  preserving the resolved workspace dependency graph and avoiding
  non-deterministic app-local installs. Generated fullstack workspaces declare
  the current authentication stack's Node.js `>=22.22.1` runtime requirement,
  and the BullMQ worker Compose example follows the same build contract.
- **Local Outer tests ignore unrelated Mailpit instances.** Email specs are
  exposed to Mailpit only when the generated API has SMTP configured for the same
  run, preventing false failures against a stale local sink.
- **Rate limits track the original visitor behind the generated web proxy.**
  Server-side API calls now forward SvelteKit's resolved client address, and the
  Redis-backed throttler uses it instead of assigning every visitor to the web
  container's shared counter. Docker and k3s configure their single trusted
  Traefik hop, while server hooks avoid redundant settings and session lookups
  for static assets and API proxy requests. Critical SSR site-settings reads use
  a separate configurable ceiling so maintenance and sign-up policy do not fail
  open under normal page traffic.
- **Generated admin smoke tests tolerate application-owned landing pages and
  hydration.** Appearance and settings-effect tests retry their first hydrated
  interaction, and the back-to-home check no longer assumes starter copy that
  applications are expected to replace.
- **API proxy preserves binary request bodies.** Generated SvelteKit proxies now
  forward request bodies as bytes, preventing multipart uploads and other binary
  payloads from being corrupted by UTF-8 text decoding.
- **Blog previews now match published article bodies.** `BlogEditor` and the new
  reusable `BlogProse` component share one safe GFM renderer and one prose style,
  including blockquotes, ordered lists, tables, and duplicate-title handling.
  Application-owned article routes can use the same managed component without
  giving up their surrounding visual design.
- **Blog publishing UI tests no longer accept the editor URL as a successful
  publish.** The generated test waits for the create response, retries an
  unhydrated first click, and verifies the exact published slug before comparing
  rendered Markdown.
- **Blog reads are public after installation.** The external blog module now
  registers `/blog` in the generated layout's public path list, so anonymous
  visitors can read the list and published articles while write actions remain
  session-protected.
- **Adding a module no longer adopts the whole working tree.** Pre-existing
  managed-file edits retain their old lock baseline and unrelated application
  files remain outside `files.lock`, preventing later updates from overwriting or
  removing application-owned work.
- **Generated Git ignores cover both Playwright execution locations.** The
  configured suite writes artifacts below `tests`, while invoking Playwright
  without that config can write authentication state and reports at the project
  root. Both locations, along with local `output/lighthouse` reports, no longer
  appear as untracked files.
- **Two-factor UI tests now wait for login hydration.** The login form is
  server-rendered before Svelte attaches its submit handler, so an immediate
  Playwright click could perform a native form reload and make otherwise valid
  2FA flows fail intermittently. The shared login helper now waits for the page
  network to settle before submitting.
- **Account UI test sessions no longer accumulate.** The Playwright session
  setup revokes stale sessions before saving its authenticated state, keeping
  the current session visible across repeated local runs.
- **Clean 3-way update merges no longer become replaceable generated output.**
  `podo update --apply --from …` used to hash the merged working file into
  `.podokit/files.lock`; a repeated update could then treat user dependencies or
  registry entries as clean and overwrite them. The lock now retains the newly
  assembled PodoKit content as the managed baseline, and unrelated application
  files are no longer adopted into the managed set during update.
- **Sidebar design tokens were missing from the base theme.** The admin-dashboard
  sidebar (shadcn-svelte) consumes `--sidebar*` CSS variables, but the
  `fullstack-nest-svelte` `app.css` never defined them nor mapped them under
  `@theme inline`, so `bg-sidebar`/`text-sidebar-foreground`/… were not generated
  and the sidebar rendered unstyled (and did not re-theme). Added the full shadcn
  sidebar token set (`--sidebar`, `--sidebar-foreground`, `--sidebar-primary`,
  `--sidebar-accent`, `--sidebar-border`, `--sidebar-ring`, …) for light and dark
  plus their `--color-sidebar*` `@theme` mappings. The Appearance theme now
  re-themes the sidebar together with the rest of the app.
- **Every sidebar item looked selected (active-state highlight leaked to all
  items).** The shadcn-svelte sidebar components (as shipped by shadcn-svelte's
  own registry) style the active item with the `data-active:` Tailwind variant,
  which matches attribute **presence** (`[data-active]`); since the buttons always
  render `data-active="true|false"`, the accent background/foreground applied to
  **every** item, not just the active one. It was nearly invisible in the default
  palette (accent ≈ sidebar) but glaring once a theme raised the contrast. This is
  an upstream shadcn-svelte bug (canonical shadcn/ui uses value-matching
  `data-[active=true]:`). Rather than diverge the vendored `ui/sidebar/*` files —
  which are kept as a **pristine mirror of the shadcn-svelte registry so
  `shadcn-svelte` updates apply cleanly** — the correction lives in the base
  `app.css`: it neutralizes the resting state of non-active menu buttons while
  leaving hover/press feedback intact. Remove once shadcn-svelte adopts
  `data-[active=true]:`.

### Added
- **Two-factor backup codes are now usable end to end.** The login page gained a
  second-factor step (missing before): a password/OTP sign-in with 2FA enabled
  now prompts for an authenticator code, with a **"use a backup code"** toggle so
  a locked-out user can sign in with a one-time backup code. The account page adds
  **Download** for the codes shown on enable and **Regenerate backup codes**
  (invalidating the previous set). Second-factor errors (wrong/expired code, too
  many attempts) are localized — mapped from the backend `code` rather than shown
  as the raw English message.
- **Require two-factor (mandatory enrolment).** A new admin Settings toggle
  ("Require two-factor") forces every signed-in user to enrol in 2FA before using
  the app: an un-enrolled user is redirected to a `/setup-2fa` enrolment page, and
  the API blocks their requests with `TWO_FACTOR_REQUIRED` (a global
  `TwoFactorRequiredGuard`) until they enrol. Admins are included; the policy
  toggle stays reachable so it is never a hard lock-out. Off by default; only
  effective when 2FA itself is enabled.

### Fixed
- **`/verify-email` was unreachable when signed out.** It was missing from the
  public-path allow-list, so a user sent there after sign-up (when email
  verification is on) was bounced to `/login`. It is now public, as intended.

## [0.8.0] - 2026-07-11

### Added
- **`podo remove <module>`.** The inverse of `podo add`: un-wires a module's
  marker injections, deletes the files it added, prunes the `package.json`
  deps/scripts and `.env.example` lines it introduced, and drops it from the
  manifest. Conservative by design — it refuses to remove a module another
  installed module still requires, keeps files you have edited (reporting them
  instead of deleting), preserves files/deps another module shares, and never
  drops database tables.

### Fixed
- **HMR behind the containerized dev proxy.** The Vite dev server's HMR client
  port now derives from the Traefik-exposed port, so hot-module reload works when
  the generated app runs behind the `compose.dev.yaml` proxy.

## [0.7.0] - 2026-07-11

### Added
- **Module-declared owned paths + durable eject.** A module manifest can list
  `ownedGlobs` so the presentation files it ships are marked *owned* — never
  overwritten by `podo update`. `podo eject` now persists the ownership change,
  so an ejected file stays owned across later `add`/`update` recomputes.
- **`app.extensions.ts` DI slot.** Generated apps get an owned
  `apps/api/src/app.extensions.ts` exporting `extensionImports`/`extensionProviders`
  that `app.module.ts` spreads in — a stable, update-safe seam for overriding or
  replacing providers (mail transport, storage adapter, custom sinks).
- **Standalone `mailer` module.** Mail sending is now its own reusable module
  instead of living inside `auth`. `auth` depends on `mailer`; the mailer reads
  SMTP defensively (config → `SMTP_*` env → json-transport) and its transport can
  be swapped through the DI slot.
- **npm-package modules.** `podo add <name>` resolves a module from the bundled
  set *or* an installed npm package `@podosoft/podokit-module-<name>`, with a
  versioned manifest as the cross-package contract. `list_modules` unions both.
- **Module-driven admin nav & settings.** The admin sidebar and settings page
  render from a registry each installed module contributes to, so menu entries
  add and remove per installed module.

### Fixed
- Correct the admin-dashboard post-install hints: admin pages live under
  `/admin/*` (not `/dashboard/*`), and password-reset email now routes through the
  auto-installed mailer module.

## [0.6.0] - 2026-07-10

### Added
- **`llms.txt` and GitMCP.** A repo-root `llms.txt` gives LLMs a curated index of
  the docs and packages. The README/getting-started now document **GitMCP**
  (`https://gitmcp.io/podosoft-dev/podokit`) — register it as a remote MCP server
  to search the PodoKit docs and code from any AI tool, no install.
- **`@podosoft/podokit-mcp` — a local MCP server.** A [Model Context Protocol](https://modelcontextprotocol.io)
  server that runs on your machine via `npx` (no hosting) so AI coding tools get
  first-class access to PodoKit: `list_templates`, `create_project`, `list_modules`,
  `add_module`, `project_status`, `list_local_edits`, `check_versions`,
  `preview_update`, and `search_docs`. Registered **globally** it can scaffold a
  project **from an empty folder** — "create a fullstack app with auth" runs
  `create_project` + `add_module`. Generated projects also ship a `.mcp.json`.
- **AI coding agent support in generated projects.** `podo create` now writes an
  `AGENTS.md` (the open standard read by Codex, Cursor, Copilot, Gemini, …)
  covering the stack, commands, code style, and `podo` tooling; a `CLAUDE.md` that
  imports it (`@AGENTS.md`) for Claude Code; and thin `.cursor/rules` /
  `.github/copilot-instructions.md` pointers. Claude Code **skills**
  (`.claude/skills/`) add procedural guidance (NestJS endpoint, SvelteKit route,
  DataTable, `podo add`/`podo update`). Modules extend `AGENTS.md` with their own
  conventions when added (auth's secure-by-default rule, admin-dashboard's
  DataTable requirement). The AI files are `owned`, so `podo update` never touches
  them. Opt out with `podo create --no-ai`.
- Module injections can be marked `optional`, so they skip (instead of failing)
  when a target file is absent — used for the `AGENTS.md` guidance injections.
- **Containerized development environment.** Generated projects now ship a
  `compose.dev.yaml` (+ `Dockerfile.dev`, `.devcontainer/`, `.env.docker`,
  `infra/traefik/`) that runs the whole stack in containers. Only Traefik binds a
  host port (`app.localhost`); `postgres`/`redis`/`minio`/`api` have no published
  ports and talk by service name, so multiple projects never collide. Module
  services are behind Compose profiles (`cache`/`storage`/`queue`); `docker compose
  watch` gives instant web HMR and restarts the api on change. A `devcontainer.json`
  lets editors and AI agents work inside the container. The host `npm run dev` loop
  still works unchanged. See the [development guide](docs/development.md).
- **Site settings.** admin-dashboard's `/admin/settings` is now split into
  **General** and **Authentication** tabs. The General tab configures the whole
  site and every value takes effect without a rebuild: the **site name** (browser
  tab title) and **favicon** (uploaded to object storage), the **brand color**
  (applied as the theme's primary accent), a **meta description**, a public
  **footer** with support-email/terms/privacy links, the **default language and
  timezone**, a **maintenance mode** that holds non-admins on a maintenance page,
  and a **sign-up toggle** that closes public registration (the sign-up endpoint
  returns 403 and the UI hides the link). Values are stored server-side
  (`/site/settings`). Requires the `object-storage-s3` module.
- **Default site title and favicon.** New apps ship a real browser `<title>` and a
  PodoKit SVG favicon instead of the framework defaults.
- A **back-to-home** link in the admin sidebar footer returns to the landing page.

### Changed
- **Faster dev reload.** The generated API's `npm run dev` uses Nest's SWC builder
  for near-instant recompiles; the production `nest build` still uses tsc.

### Fixed
- **`file-upload` module build.** The generated app's API tsconfig restricts
  `types` to `["node"]`, which suppressed `@types/multer`'s global augmentation and
  broke the build on `Express.Multer.File`. The files controller now loads it
  explicitly with a `/// <reference types="multer" />` directive.
- **shadcn-svelte tabs.** The vendored tabs primitive targeted a `data-active`
  attribute that current bits-ui doesn't emit, so the active tab lost its
  highlight; restored the official component (`data-[state=active]`).
- **General settings layout** now fills the content width responsively instead of
  being left-skewed on wide screens.
- **Containerized dev builds.** `Dockerfile.dev` resolves dependencies inside the
  container (no host lockfile copy) so platform-specific optional binaries like
  `@swc/cli` install correctly on Linux.

## [0.5.1] - 2026-07-10

### Fixed
- Organizations e2e: delete the child org before the parent (a child row also
  shows the parent's name, so the parent-name row match wasn't unique), fixing a
  flaky `strict mode violation` in the shipped Playwright spec.

### Changed
- Documentation refresh for v0.5.0. The root and CLI READMEs now cover the
  `podo status`/`diff`/`doctor`/`update`/`eject` commands and the
  `@podosoft/podokit-contracts`, `@podosoft/podokit-api-client`, and
  `@podosoft/podokit-auth` packages; the updating guide documents `podo update`
  (3-way merge) and `podo eject`.
- Added a README for `@podosoft/podokit-auth` (previously missing on npm).
- Added admin-dashboard screenshots (users, audit log, runtime settings) and
  fixed stale ports (`:3000`/`:5173` → `:5002`/`:5001`) and admin route paths
  (`/dashboard/*` → `/admin/*`) across the docs.

## [0.5.0] - 2026-07-10

### Added
- **Project updateability** — generated projects now record how they were assembled in a committed `.podokit/` directory (template, modules, render answers, and a per-file ownership tier: managed / assembled / owned with content hashes). New `podo` commands: `status`, `diff` (files you've edited), `doctor` (framework version compatibility), `update` (preview or `--apply` a version update, 3-way merging your edits and never touching owned files), and `eject` (take ownership of a managed file). Injection points are bracketed by `// podokit:begin:… / …:end` fences so wiring recomputes deterministically.
- **`@podosoft/podokit-contracts`** — a zero-dependency package holding the contracts the backend and frontend share: `Capabilities`, the REST error envelope, and `AppException`.
- **`@podosoft/podokit-auth`** — the DB-backed auth configuration pipeline (envelope-encrypted secrets, the `AuthConfig` model, and a config store), free of better-auth coupling.
- **DB-backed runtime auth config** — OAuth providers, SMTP, and server-enforced toggles (email verification, breached-password check, self-delete, audit log) move to a DB-backed `auth_config` with per-field env fallback, applied without a restart. Config secrets are AES-256-GCM envelope-encrypted (key derived from `BETTER_AUTH_SECRET`), never returned to clients, and never logged.
- **`admin-dashboard` module** — a ready-made admin dashboard on top of `auth`: login/signup/password-reset pages, a shadcn-svelte sidebar shell, and user + session management via the better-auth admin plugin (`ADMIN_EMAILS` are promoted to admin on sign-up). All API access goes through the ApiClient; routes are server-guarded. Verified end-to-end.
- **`@podosoft/podokit-api-client`** — a new published package so frontends never call the backend with a raw `fetch`. `client.auth` is the better-auth client (email/password, sessions, admin plugin); `client.get/post/put/patch/del` call the app's REST endpoints, parse the standard error envelope, and throw `ApiError`. `baseUrl`/`fetch` are injectable for browser (same-origin proxy) and SSR (internal URL, cookie forwarding).
- The `fullstack-nest-svelte` and `todo` templates now use `@podosoft/podokit-api-client` for all API access, with SvelteKit proxy routes (`/api/auth/[...all]`, `/api/[...path]`) that forward cookies and relay `Set-Cookie`. A `#lib/api.js` (browser) and `#lib/server/api.js` (SSR) factory ship in the templates.

### Fixed
- CLI build now cleans `dist/templates` before copying, so files removed from a template no longer linger in the published package.

### Changed
- Upgraded to **TypeScript 6** and migrated `moduleResolution` from the deprecated `node10` (`Node`) to **`nodenext`** across the monorepo and the generated NestJS templates (removed in TS 7; the starter is now future-proof). `@types/node` stays on the Node 20 baseline. Verified: monorepo build/lint/test, and generated fullstack/todo/admin-dashboard apps build (nest build + svelte-check) and run.

## [0.3.0] - 2026-07-05

### Added
- **More preinstalled shadcn-svelte components** in the fullstack and todo templates: `select`, `dialog`, `dropdown-menu`, `tabs`, `table`, `avatar`, `badge`, `skeleton`, `separator`, `tooltip`, `alert`, and `sonner` (toasts) — on top of the existing `button`/`input`/`card`/`checkbox`/`label`. Bumps `mode-watcher` to v1.
- **`api-key-auth` module** — API-key auth for machine/service clients (`X-API-Key`), separate from user sessions: an `ApiKeyGuard` + `@ApiKeyProtected()` decorator that opens a route to key holders (constant-time check against `API_KEYS`). Requires `auth`. Verified end-to-end (valid key 200, missing/invalid 401, session routes unaffected).
- **`rate-limit` module** — rate limiting with `@nestjs/throttler` backed by Redis (auto-added), so the limit holds across API replicas; installs a global throttler guard (429 when exceeded), configurable via `RATE_LIMIT_TTL`/`RATE_LIMIT_MAX`. Verified end-to-end (requests over the limit return 429).
- **`audit-log` module** — a global interceptor that records every mutating request (POST/PUT/PATCH/DELETE) to an `audit_logs` table with the acting user, method, path, and status; read recent entries at `/audit-logs`. Requires (and auto-adds) `auth`. Verified end-to-end: an authenticated `POST /todos` is recorded with the user's id.
- **`auth` module (better-auth)** — full authentication: email/password + sessions out of the box, with OAuth and 2FA by config. Installs a **global auth guard** so the API is **secure by default** (every route needs a session except `/health` and `/api/auth/*`; opt out with `@Public()`, read the user with `@Session()`). This is the identity foundation upcoming security/audit modules build on. Verified end-to-end: sign-up → session → protected route; health/api-docs stay public.
- **`logging` module** — structured request logging (nestjs-pino) with a per-request correlation id (`x-request-id`, honored and echoed); pretty in dev, JSON in production. Verified end-to-end (requests logged with a reqId; inbound `x-request-id` reused).

### Changed
- Upgraded the API templates to **NestJS 11** (Express 5); modules updated accordingly.
- Replaced the thin `auth-jwt` module with the comprehensive better-auth `auth` module.

### Fixed
- i18n scaffold: the `ko` locale imported `Translation` from `typesafe-i18n` (a generated type, not exported by the package), which broke `svelte-check`. It now uses `BaseTranslation` until you run `npx typesafe-i18n`. Generated apps pass `svelte-check` with no errors.
- `auth` module: register the demo `AccountController` via an `AccountModule` so `/account/me` resolves (was 404).

## [0.2.0] - 2026-07-05

### Added
- **Preinstalled shadcn-svelte components** in the fullstack and todo templates (`button`, `input`, `card`, `checkbox`, `label`) with the full theme in `app.css` and a `cn` helper. The generated UIs now use real shadcn-svelte components instead of raw HTML, and the docs cover adding more components (`shadcn-svelte add`) and theming.
- **`redis` module** — an ioredis client (`get`/`set`/`del` + `publish`/`subscribe`) as a global `RedisService`, with demo `/cache` endpoints.
- **`job-progress` module** — live job progress streaming that composes `bullmq` + `redis` + `sse`: the worker reports progress over Redis pub/sub and the API relays it to SSE clients. Verified end-to-end (a job streams `20 -> 40 -> 60 -> 80 -> 100` from the worker to an open SSE stream). Module wiring can now inject into other modules' files via markers.
- **`sse` module** — Server-Sent Events with a `/events/stream` endpoint (heartbeat + published messages) and a `POST /events` publisher; a global `EventsService` lets any module broadcast updates. Verified end-to-end (a published message is received on an open stream).
- **`file-upload` module** — a multipart upload endpoint that stores files via object storage and returns a presigned URL. Declares a dependency on `object-storage-s3`, which the module system now **auto-adds** when missing. Verified end-to-end against MinIO (upload → presigned URL round-trip).
- **Module dependencies** — modules can declare `requires`; `podo add` applies missing dependencies first.
- **`object-storage-s3` module** — S3-compatible object storage that supports **both AWS S3 and MinIO** via a `STORAGE_PROVIDER` env var. Ships a `StorageService` (put/get/delete + presigned URLs), demo `/storage` endpoints, and a MinIO dev Compose overlay. Verified end-to-end against MinIO (put → get round-trip + presigned URL).
- **`bullmq` module** — background jobs with a demo queue, enqueue/status endpoints, and a **separate worker process** (`main-worker.ts`, `dev:worker`/`start:worker` scripts). Adds a k3s worker Deployment and a Docker Compose worker example so deployments run the worker as its own process. Verified end-to-end: enqueued jobs stay `waiting` until the worker runs, then complete.
- **Module system: `podo add <module>`** — add composable features to an existing project. A module overlays files, merges dependencies, appends env vars, and wires itself into the NestJS app at marker comments.
- **`auth-jwt` module** — JWT authentication for the API: register, login, a JWT guard, and a protected `/auth/me` route backed by a TypeORM `users` table. Verified end-to-end: generate → `add auth-jwt` → install → build → migrate → register/login/`/auth/me`.

- **`fullstack-nest-svelte`** (default) is now a clean starter: schema-validated env (zod), `/health` + `/health/ready`, **Swagger** at `/api-docs`, and **TypeORM + PostgreSQL wired with no domain code** — you add your own entities.
- New **`todo`** template: the fullstack starter plus a worked Todo CRUD example (TypeORM entity, versioned migration, Swagger, and a SvelteKit todo UI through the server-side proxy). Verified end-to-end: install, build, `docker compose up`, `migration:run`, todo CRUD, `/api-docs`.
- The CLI now lists templates with descriptions (in prompts and `--help`).
- Screenshots of the generated todo app (web UI and API docs) in the README, templates guide, and examples.

### Changed
- Templates are now distinct: `base` (minimal), `fullstack-nest-svelte` (clean default), and `todo` (example) — instead of baking the todo example into the default template.

## [0.1.1] - 2026-07-05

### Documentation
- Add package READMEs for `@podosoft/podokit` (the npm landing page) and `@podosoft/podokit-template-engine`.
- Expand the repository README, Getting Started guide, and add a Templates guide.

## [0.1.0] - 2026-07-05

### Added
- Initial repository scaffold: README, license (Apache-2.0), community health files, npm workspace root, CI workflow, issue/PR templates, Dependabot config.
- `@podosoft/podokit-template-engine`: token rendering, recursive template copy (with `dot-` file convention), and package.json deep-merge utilities.
- `@podosoft/podokit` CLI with `podo create <name>`: scaffolds a workspace from a template, with `--template`, `--dir`, and `--pm` options.
- Interactive prompts for `podo create` (template and package manager) when run in a terminal; `--yes` and non-TTY runs use defaults, and explicit flags always win.
- `templates/base`: minimal npm-workspace starter (apps/api, apps/web, env example).
- `templates/fullstack-nest-svelte` (default): NestJS API (config validation, `/health`, standard error envelope) + SvelteKit web (TailwindCSS v4, shadcn-svelte config, typesafe-i18n scaffold, server-side API proxy) + Docker Compose and k3s manifests.

### Fixed
- `fullstack-nest-svelte`: add missing `@types/express` so the generated API builds cleanly. Verified end-to-end: install, build (API + web), API starts, `/health` returns 200.

[Unreleased]: https://github.com/podosoft-dev/podokit/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/podosoft-dev/podokit/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/podosoft-dev/podokit/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/podosoft-dev/podokit/compare/v0.3.0...v0.5.0
[0.3.0]: https://github.com/podosoft-dev/podokit/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/podosoft-dev/podokit/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/podosoft-dev/podokit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/podosoft-dev/podokit/releases/tag/v0.1.0
