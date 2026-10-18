# @podosoft/podokit

## 1.6.4

### Patch Changes

- [#256](https://github.com/podosoft-dev/podokit/pull/256) [`27b4985`](https://github.com/podosoft-dev/podokit/commit/27b498514b712083723c888059f296181ed3cc9b) Thanks [@korone00](https://github.com/korone00)! - Security: stop `ADMIN_EMAILS` from making an administrator of anyone who signs up with a listed address. The generated `auth.ts` gave the admin role and sign-up approval to every new account whose email was in `ADMIN_EMAILS`, checking only the address, so while email and password sign-up was open and email verification was off, anyone could register a listed address that had no account yet, such as a never-replaced `admin@example.com`, and become an approved administrator at once, bypassing sign-up approval. A listed address now makes an administrator only of an account that proves it as it is created: through `admin:bootstrap` or an administrator, or a sign-in that creates the account with a verified address (a social provider that reports the email verified, a magic link, or an email code). Any other new account with a listed address is refused with `PUBLIC_SIGNUP_DISABLED`. With `NODE_ENV=production` the API refuses to start when `ADMIN_EMAILS` lists an entry that is not an address or that is on a name reserved for documentation (`example.com`, `example.net`, `example.org`, `.example`, `.test`, `.invalid`, `.localhost`), and `podo deploy doctor` now reads that one value from the profile's `runtimeConfig`, the API Secret, or the API env file and fails on such an entry. The `admin-dashboard` Playwright seed no longer signs the administrator up: create it with `admin:bootstrap` before the suite runs.

- [#257](https://github.com/podosoft-dev/podokit/pull/257) [`947553a`](https://github.com/podosoft-dev/podokit/commit/947553a140bf53b7b657e71f6acc08690056591c) Thanks [@korone00](https://github.com/korone00)! - Make the `audit-log` module record every new account and name the user of sign-outs and token requests. `auth.signup` was recorded only for `POST /sign-up/email`, so an account created by a social provider's callback, a magic link, an email code, or an application's plugin left no sign-up entry, and one that waited for sign-up approval, which gets no session and so no `auth.login`, left no entry at all. The audit plugin now records `auth.signup` from Better Auth's user creation, whichever endpoint creates the account and even when the request then fails, with `metadata.method` and, for social sign-up, `metadata.provider`; `/admin/create-user` stays `user.create` only, now with the new user's id. `auth.logout` had no actor, because `/sign-out` loads no session and the session is gone by the after hook; it now names each account whose session the sign-out ended, and a sign-out without a session records nothing. Password resets by link, email code, or text message code and email verifications by link or code now name the account they changed, `user.session_revoke` names the owner of the revoked session, `user.stop_impersonate` names the administrator, and email changes by code are recorded.

- [#259](https://github.com/podosoft-dev/podokit/pull/259) [`58638d8`](https://github.com/podosoft-dev/podokit/commit/58638d8262b2e1c3a44bcad3c0cb3f5dd3f11ff5) Thanks [@korone00](https://github.com/korone00)! - Keep a Docker Compose deployment answering while `podo deploy apply` and `rollback` replace it. They ran one `compose up`, which stops every changed service before it starts any of them, so a one-host deployment returned 502 until the new API, web server, and gateway had started one after another and passed their healthchecks, and an API holding a WebSocket or server-sent events stream first stayed in shutdown until Docker's 10-second stop timeout. The new API containers, and the new web server behind the gateway, now start beside the running ones, and the old ones stop only once the new ones are healthy; if a new container is not healthy, the containers the rollout started are removed and the old ones keep serving. The gateway no longer carries the release label, so it is replaced only when its own definition changes, and the web service sets `BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS` to `"0"` so it follows the API to its new containers. The object storage init job runs with the dependencies, before the migration, and a profile without managed dependencies no longer replaces running containers before the migration. The connection budget counts the old API containers beside the new ones.

## 1.6.3

### Patch Changes

- [#250](https://github.com/podosoft-dev/podokit/pull/250) [`e6a6825`](https://github.com/podosoft-dev/podokit/commit/e6a68252598bd8f7066a0036f8183dad11cf1faf) Thanks [@korone00](https://github.com/korone00)! - Make the `audit-log` module record a sign-in through any endpoint, including those of Better Auth plugins an application adds to its own `auth.ts`, such as `@better-auth/electron`'s `/electron/token`. The audit plugin recorded `auth.login` only for the endpoints in its `SIGN_IN_METHODS` list, so a desktop app's sign-in left no entry. It now records a request that ends with a new session it did not come with, naming the endpoint's path in `metadata.method` when the endpoint is not in `SIGN_IN_METHODS`, except the endpoints in the new `NOT_SIGN_INS` list: sign-up, impersonation, switching between a browser's sessions, and requests that replace the signed-in user's own session. Session reads and updates that refresh the request's own session, bearer and API key requests included, and endpoints that another endpoint dispatches are not recorded as sign-ins.

- [#250](https://github.com/podosoft-dev/podokit/pull/250) [`e6a6825`](https://github.com/podosoft-dev/podokit/commit/e6a68252598bd8f7066a0036f8183dad11cf1faf) Thanks [@korone00](https://github.com/korone00)! - Make the generated API's database spec look up a host that does not exist through a DNS server on a local UDP port instead of the system resolver, so its result no longer depends on the machine's DNS. The test fetched `http://database.invalid/` and timed out after 30 seconds on CI runners whose resolver did not answer. It now checks a real `NXDOMAIN` answer (`ENOTFOUND`) in milliseconds and, in a new test, a resolver that never answers (`ETIMEOUT`) in about a second.

- [#252](https://github.com/podosoft-dev/podokit/pull/252) [`4bcb93a`](https://github.com/podosoft-dev/podokit/commit/4bcb93a42af36f9db4c0ded59cd11e65fc887b73) Thanks [@korone00](https://github.com/korone00)! - Make the `admin-dashboard` module's email specs run only when the app under test delivers its mail to the Mailpit they read. They ran whenever a Mailpit answered on `MAILPIT_URL` (default `http://localhost:8025`), so in an app without SMTP, or one that sends to another catcher, another project's Mailpit on that port made every email test wait for a message that never came and fail. Before the first email test, each worker now has the app send a password reset email to a throwaway account and waits up to five seconds for it in that Mailpit; when it does not arrive, the email tests skip with the cause. `E2E_REQUIRE_MAIL=true` makes them fail instead.

- [#250](https://github.com/podosoft-dev/podokit/pull/250) [`e6a6825`](https://github.com/podosoft-dev/podokit/commit/e6a68252598bd8f7066a0036f8183dad11cf1faf) Thanks [@korone00](https://github.com/korone00)! - Make the `rate-limit` module's spec decide from time instead of a fixed limit whether it can send a budget's worth of requests. The 429 test skipped only above a general limit of 10,000, so at a raised local limit such as `RATE_LIMIT_MAX=6000` it failed on the 30-second test timeout. It and the session read test now time their first 50 requests and skip, naming the pace and the time needed, when the rest would take more than half of the time the test has left; at the default limits they run as before.

## 1.6.2

### Patch Changes

- [#247](https://github.com/podosoft-dev/podokit/pull/247) [`1ea733a`](https://github.com/podosoft-dev/podokit/commit/1ea733aa40c416555282602ad4cba76236038c8c) Thanks [@korone00](https://github.com/korone00)! - Record every sign-in method in the audit log, and only requests that succeeded. The audit-log module's Better Auth hook recorded `auth.login` only for `/sign-in/email`, so social, magic link, email code, passkey, phone number, username, and two-factor sign-ins left no entry. It also ran for failed requests and before two-factor's hook, so a wrong password, a forbidden admin call such as a non-administrator's `/admin/ban-user`, a failed password change, and the password step of a two-factor sign-in were recorded as completed actions. The hook is now a plugin that `auth.ts` pushes after every other plugin. It skips failed requests, records `auth.login` when a request ends with a session it did not come with, with `metadata.method` and, for social sign-in, `metadata.provider`, and records a two-factor sign-in when the second factor completes it. `podo update` replaces the `hooks.after = auditAfterHook;` line in `apps/api/src/auth/auth.ts`; an application that owns `auth.ts` replaces it and its import with `plugins.push(auditPlugin());` and `import { auditPlugin } from "../audit/audit-hook";`.

- [#247](https://github.com/podosoft-dev/podokit/pull/247) [`1ea733a`](https://github.com/podosoft-dev/podokit/commit/1ea733aa40c416555282602ad4cba76236038c8c) Thanks [@korone00](https://github.com/korone00)! - Answer an organization's `list-members` with an empty list instead of a 500 on PostgreSQL when a filter or a page matches no member: the `auth` module now runs Better Auth's PostgreSQL queries through a Kysely instance that sends an empty `in` list as `1 = 0` and an empty `not in` list as `1 = 1`, where Better Auth's adapter sent `IN ()`. Generated APIs depend on `kysely` directly.

- [#247](https://github.com/podosoft-dev/podokit/pull/247) [`1ea733a`](https://github.com/podosoft-dev/podokit/commit/1ea733aa40c416555282602ad4cba76236038c8c) Thanks [@korone00](https://github.com/korone00)! - Keep Kubernetes API and web pods serving while a rolling update removes them. A terminating pod still receives new connections until every node and the ingress controller drop it from the Service's endpoints, but the servers stop accepting connections on `SIGTERM`, so a rollout could answer a request with a 502. The rendered API and web containers now have a `preStop` hook that runs `sleep 5` before `SIGTERM`, and their pods a `terminationGracePeriodSeconds` that covers the hook, the web server's `SHUTDOWN_TIMEOUT` drain (30 seconds unless `runtimeConfig` sets it), and 5 seconds to exit: 40 by default instead of Kubernetes' 30. The rendered manifests change, so the next `podo deploy plan` produces a new confirmation hash.

- [#247](https://github.com/podosoft-dev/podokit/pull/247) [`1ea733a`](https://github.com/podosoft-dev/podokit/commit/1ea733aa40c416555282602ad4cba76236038c8c) Thanks [@korone00](https://github.com/korone00)! - Make the generated `podokit-deploy` agent skill report the `previousPods` of `podo deploy status` apart from the current revision's `restartCount`, instead of "restart totals", so an agent does not attribute the restarts of pods that `apply` or `rollback` replaced to the new release.

- [#247](https://github.com/podosoft-dev/podokit/pull/247) [`1ea733a`](https://github.com/podosoft-dev/podokit/commit/1ea733aa40c416555282602ad4cba76236038c8c) Thanks [@korone00](https://github.com/korone00)! - Make `podo deploy status` on Kubernetes count only the restarts of the running pods of each Deployment's current revision, matched through the ReplicaSet that carries its `deployment.kubernetes.io/revision` annotation, instead of every pod with the workload label. Pods of an earlier revision or still terminating, which remain for their grace period after `podo deploy apply` and `rollback`, are reported separately as `previousPods` with their count and restarts, so a fresh release no longer shows the replaced pods' restarts. Pods and ReplicaSets are read as JSON and an unexpected shape fails the command.

- [#247](https://github.com/podosoft-dev/podokit/pull/247) [`1ea733a`](https://github.com/podosoft-dev/podokit/commit/1ea733aa40c416555282602ad4cba76236038c8c) Thanks [@korone00](https://github.com/korone00)! - Make the `rate-limit` module's spec read each budget's limit from the API's `RateLimit-Limit` header instead of expecting the module defaults when the runner's environment does not set them, so it passes against a stack with other limits, such as the development example's `RATE_LIMIT_MAX=100` or raised local limits. Limits set in the runner's environment are still checked, counts compared across requests are checked again in a new window when a short `RATE_LIMIT_TTL` ends in between, the session read test skips with its reason when the authentication limit is not below the runtime one, and `E2E_SKIP_RATE_LIMIT=true` still skips the file.

- [#247](https://github.com/podosoft-dev/podokit/pull/247) [`1ea733a`](https://github.com/podosoft-dev/podokit/commit/1ea733aa40c416555282602ad4cba76236038c8c) Thanks [@korone00](https://github.com/korone00)! - Count a Kubernetes rollout as twice the API and worker replicas in the PostgreSQL connection budget of `podo deploy doctor` and `podo deploy plan`, instead of one surge pod more per workload. Kubernetes starts the next replacement as soon as the previous one is ready without counting terminating pods against `maxSurge`, and a replaced pod keeps its pools until it exits, so every old pod can still hold connections while all the new ones run. With the defaults and `auth`, two API replicas now count 124 during a rollout instead of 93, above the 97 that the default `max_connections` leaves, so the doctor and the plan warn until the pools are lowered or the limit raised.

- [#247](https://github.com/podosoft-dev/podokit/pull/247) [`1ea733a`](https://github.com/podosoft-dev/podokit/commit/1ea733aa40c416555282602ad4cba76236038c8c) Thanks [@korone00](https://github.com/korone00)! - Run the generated theme spec in apps without an account menu page instead of skipping it: it opens the new `themeToggle` entry of `tests/helpers/app-paths.ts`, which defaults to `accountMenu` and, when that is `null`, to the admin console, whose header renders the theme toggle.

- [#247](https://github.com/podosoft-dev/podokit/pull/247) [`1ea733a`](https://github.com/podosoft-dev/podokit/commit/1ea733aa40c416555282602ad4cba76236038c8c) Thanks [@korone00](https://github.com/korone00)! - Make `podo update --apply` 3-way merge edited managed files without `--from`. The merge base is now the templates of the version `.podokit/manifest.json` records: the installed CLI's own when the project is on that version, and otherwise `@podosoft/podokit@<version>` installed from the npm registry into a temporary directory, as previous external modules already were. Before, an update without `--from` left every edited managed file unmerged and reported it as a conflict while the lock and manifest moved on, so its upstream changes were never applied. When the registry cannot provide that version, `--apply` now stops before writing anything and lists the files that need it; `--from <dir>` still takes precedence. Edited files without a merge base, such as one the previous version did not generate or one the new version removes, are listed with the reason as `skipped` instead of as conflicts.

## 1.6.1

### Patch Changes

- [#244](https://github.com/podosoft-dev/podokit/pull/244) [`9154af2`](https://github.com/podosoft-dev/podokit/commit/9154af27522620d6147ca5a6e3d4357d3e9f2b7c) Thanks [@korone00](https://github.com/korone00)! - Make the generated admin navigation unit test stand in for module entries the way it does for the application's, so it no longer fails in apps whose modules add admin pages, such as blog and analytics.

- [#244](https://github.com/podosoft-dev/podokit/pull/244) [`9154af2`](https://github.com/podosoft-dev/podokit/commit/9154af27522620d6147ca5a6e3d4357d3e9f2b7c) Thanks [@korone00](https://github.com/korone00)! - Start the temporary builds of the generated API build test without the application's own build targets, so an app that lists entry points in `scripts/build.extensions.mjs` no longer fails four of its tests.

- [#244](https://github.com/podosoft-dev/podokit/pull/244) [`9154af2`](https://github.com/podosoft-dev/podokit/commit/9154af27522620d6147ca5a6e3d4357d3e9f2b7c) Thanks [@korone00](https://github.com/korone00)! - Remove finished runs of `JobQueue.schedule()` beyond a limit instead of keeping every one: after a scheduled run finishes, the BullMQ and local providers keep the newest 100 completed and 1000 failed jobs of its name, and a new optional `ScheduleOptions` argument sets `keepCompleted` and `keepFailed` (0 removes only the run). The runtime exports `ScheduleOptions`, `scheduleRetention()`, and the default limits.

- [#244](https://github.com/podosoft-dev/podokit/pull/244) [`9154af2`](https://github.com/podosoft-dev/podokit/commit/9154af27522620d6147ca5a6e3d4357d3e9f2b7c) Thanks [@korone00](https://github.com/korone00)! - Make the generated API contract check (`bun run contract`) expect a provider module's routes only while `PROVIDERS` selects its provider, including a `<CAPABILITY>_PROVIDER` override, so an app with both object-storage, cache, or jobs providers installed no longer fails on the unselected module's routes. The check now also covers the `jobs-local` routes.

- [#244](https://github.com/podosoft-dev/podokit/pull/244) [`9154af2`](https://github.com/podosoft-dev/podokit/commit/9154af27522620d6147ca5a6e3d4357d3e9f2b7c) Thanks [@korone00](https://github.com/korone00)! - Run the tests tagged `@exclusive` in a second Playwright run when `E2E_WORKERS` is above 1. The `test:e2e` scripts start the suite through the new `tests/run-e2e.ts`, so a failing test no longer leaves the exclusive tests not run, and the suite still fails when either run fails.

- [#244](https://github.com/podosoft-dev/podokit/pull/244) [`9154af2`](https://github.com/podosoft-dev/podokit/commit/9154af27522620d6147ca5a6e3d4357d3e9f2b7c) Thanks [@korone00](https://github.com/korone00)! - Let `dependencies.postgres.appPools` entries in a deployment profile state a fixed `size` instead of a `sizeKey`, so `podo deploy doctor` and `podo deploy plan` count application pools whose size the code sets, such as a TypeORM data source with the `pg` default of 10, instead of rejecting them and under-counting the connections.

- [#244](https://github.com/podosoft-dev/podokit/pull/244) [`9154af2`](https://github.com/podosoft-dev/podokit/commit/9154af27522620d6147ca5a6e3d4357d3e9f2b7c) Thanks [@korone00](https://github.com/korone00)! - Sign the object storage and SSE specs in as the administrator through the new `tests/helpers/seeded-admin.ts`, which reads the application's `app-accounts.ts` and `E2E_*` values, instead of a hard-coded `admin@example.com` and password, and extend the check that managed specs name seeded accounts only through the account helpers to `E2E_*` variables and the external module packages.

- [#244](https://github.com/podosoft-dev/podokit/pull/244) [`9154af2`](https://github.com/podosoft-dev/podokit/commit/9154af27522620d6147ca5a6e3d4357d3e9f2b7c) Thanks [@korone00](https://github.com/korone00)! - Make the generated theme spec wait for hydration after it reloads the page and find the theme toggle by its new `data-testid="theme-toggle"` on the `accountMenu` page from `tests/helpers/app-paths.ts`, so it no longer fails against a development server or with an application's own header.
- Updated dependencies [[`9154af2`](https://github.com/podosoft-dev/podokit/commit/9154af27522620d6147ca5a6e3d4357d3e9f2b7c)]:
  - @podosoft/podokit-runtime@0.5.1

## 1.6.0

### Minor Changes

- [#241](https://github.com/podosoft-dev/podokit/pull/241) [`9b5322b`](https://github.com/podosoft-dev/podokit/commit/9b5322bc5e4f2cea726dd62929cce0470eb3b14d) Thanks [@korone00](https://github.com/korone00)! - Show the application's flags on the admin Settings page. Each flag listed in `APP_FLAG_SETTINGS` of the admin-dashboard's application-owned `apps/web/src/lib/admin/app-flags.ts` gets a switch on an Application tab, labelled from the app's catalog and saved through `PUT /account/settings` with the same administrator requirement as the Authentication tab's switches; the tab is hidden while the list is empty. A managed `tests/ui/app-flags.ui.spec.ts` covers it. The settings page's tab list wraps on narrow screens in new apps.

- [#241](https://github.com/podosoft-dev/podokit/pull/241) [`9b5322b`](https://github.com/podosoft-dev/podokit/commit/9b5322bc5e4f2cea726dd62929cce0470eb3b14d) Thanks [@korone00](https://github.com/korone00)! - Add the application-owned `apps/api/scripts/build.extensions.mjs` with `appBuildTargets`, entry points the API build bundles next to PodoKit's, so apps stop editing the managed `scripts/build.mjs`. A missing entry point fails the build.

- [#241](https://github.com/podosoft-dev/podokit/pull/241) [`9b5322b`](https://github.com/podosoft-dev/podokit/commit/9b5322bc5e4f2cea726dd62929cce0470eb3b14d) Thanks [@korone00](https://github.com/korone00)! - Add the application-owned `apps/api/src/core/api-contract.extensions.ts` with `APP_DOCUMENTED_ROUTES`. `bun run contract` fails when one of those operations is not registered or missing from the OpenAPI document, so apps stop editing the managed `verify-api-contract.ts` and `api-contract.ts` to check their own routes. Both `{id}` and `:id` parameter syntax are accepted.

- [#241](https://github.com/podosoft-dev/podokit/pull/241) [`9b5322b`](https://github.com/podosoft-dev/podokit/commit/9b5322bc5e4f2cea726dd62929cce0470eb3b14d) Thanks [@korone00](https://github.com/korone00)! - Add the application-owned `apps/api/src/database/entities.ts` (`APP_ENTITIES`), which the migration data source loads, and enable `experimentalDecorators` and `emitDecoratorMetadata` in the API's `tsconfig.json`, so apps stop editing `data-source.ts` and `tsconfig.json` for TypeORM entities. `migration:generate` works again: the `typeorm` script runs the CLI on Bun, `data-source.ts` exports only `appDataSource`, and `ts-node` is no longer a dependency.

- [#241](https://github.com/podosoft-dev/podokit/pull/241) [`9b5322b`](https://github.com/podosoft-dev/podokit/commit/9b5322bc5e4f2cea726dd62929cce0470eb3b14d) Thanks [@korone00](https://github.com/korone00)! - Add the application-owned `apps/api/src/config/env.extensions.ts`. Its `appEnvShape` fields are validated with PodoKit's environment at startup and typed on `AppEnv`, and `refineAppEnv(env, context)` adds cross-variable checks, so apps stop editing the managed `env.validation.ts`. Redefining a PodoKit variable fails at startup. `podo update` seeds the file once.

- [#241](https://github.com/podosoft-dev/podokit/pull/241) [`9b5322b`](https://github.com/podosoft-dev/podokit/commit/9b5322bc5e4f2cea726dd62929cce0470eb3b14d) Thanks [@korone00](https://github.com/korone00)! - Add `HOST` (the API's listen address, default `0.0.0.0`) and `SQLITE_PATH` (the SQLite file when `DATABASE_URL` is unset, default `./data/podokit.sqlite`) to the validated API environment, so apps no longer edit the managed `main.ts` or `database.ts` to bind to loopback or move the database. `databaseUrl()` takes the provider as an optional second argument.

- [#241](https://github.com/podosoft-dev/podokit/pull/241) [`9b5322b`](https://github.com/podosoft-dev/podokit/commit/9b5322bc5e4f2cea726dd62929cce0470eb3b14d) Thanks [@korone00](https://github.com/korone00)! - Let `AppException` carry `details`. Its optional fourth argument is returned as `error.details` in the API's error envelope, so apps stop subclassing it and editing the managed `app.ts`. The API's error rendering moved into the exported `renderError()`.

- [#240](https://github.com/podosoft-dev/podokit/pull/240) [`c3e309d`](https://github.com/podosoft-dev/podokit/commit/c3e309db8ac10d8f134db4bd79e3220f11163845) Thanks [@korone00](https://github.com/korone00)! - Add an application-owned stylesheet, `apps/web/src/app.extensions.css`, that the managed `app.css` imports last. Theme variable overrides, `@theme` entries, fonts, base styles, and `@source` lines for packages whose built components use Tailwind classes go there instead of into `app.css`. `podo update` creates the file once and never overwrites it.

- [#241](https://github.com/podosoft-dev/podokit/pull/241) [`9b5322b`](https://github.com/podosoft-dev/podokit/commit/9b5322bc5e4f2cea726dd62929cce0470eb3b14d) Thanks [@korone00](https://github.com/korone00)! - Add the auth module's application-owned `apps/api/src/settings/app-flags.ts` with `APP_FLAG_DEFAULTS`. Application flags are stored with the feature flags, changed with `PUT /account/settings`, read with `SettingsService.getBool()`, and returned as `appFlags` by `GET /account/capabilities` (`Capabilities.appFlags`), so apps stop editing the managed `flag-defaults.ts` and adding their own capability routes. A name PodoKit already uses fails at startup.

- [#241](https://github.com/podosoft-dev/podokit/pull/241) [`9b5322b`](https://github.com/podosoft-dev/podokit/commit/9b5322bc5e4f2cea726dd62929cce0470eb3b14d) Thanks [@korone00](https://github.com/korone00)! - Name the app in sign-in prompts. Better Auth's `appName`, the TOTP issuer shown by authenticator apps, and the passkey relying-party name shown by browsers now come from one value: `AUTH_APP_NAME` when set, otherwise the admin site name (`site.name`), otherwise the project name. Before, users saw "Better Auth" and "PodoKit". `AuthConfig` gains `appName`, and `createConfigStore()` takes `appNameSetting` (an app_setting key whose change changes the config version) and `defaults.appName`.

- [#240](https://github.com/podosoft-dev/podokit/pull/240) [`c3e309d`](https://github.com/podosoft-dev/podokit/commit/c3e309db8ac10d8f134db4bd79e3220f11163845) Thanks [@korone00](https://github.com/korone00)! - Let a `DataTable` column render its own header content. A column's `head` snippet replaces the label and sort button, for example a select-all checkbox for bulk actions, so applications no longer edit the managed `data-table.svelte` for it.

- [#239](https://github.com/podosoft-dev/podokit/pull/239) [`29708c8`](https://github.com/podosoft-dev/podokit/commit/29708c8f134442a3014961ef54f5474d14df1c68) Thanks [@korone00](https://github.com/korone00)! - Start production deployments with the audit log on, and let `podo deploy doctor` warn. With the `audit-log` module installed, `podo deploy init` sets `AUDIT_LOG_ENABLED: "true"` in the profile's `runtimeConfig` for both drivers, and the module adds it to the example `infra/k3s/configmap.yaml`. The doctor now checks the profile against the application before it contacts the target and reports settings that deploy but probably not as intended as `warn` lines (`"warning": true` in JSON), which do not stop `apply`; it warns when `AUDIT_LOG_ENABLED` is missing or not `"true"`.

- [#239](https://github.com/podosoft-dev/podokit/pull/239) [`29708c8`](https://github.com/podosoft-dev/podokit/commit/29708c8f134442a3014961ef54f5474d14df1c68) Thanks [@korone00](https://github.com/korone00)! - Count the PostgreSQL connections a deployment can open in `podo deploy doctor` and `podo deploy plan`: every API and worker process with `DB_POOL_MAX` + 1 and, with `auth`, `DB_AUTH_POOL_MAX`, one surge pod per workload during a Kubernetes rollout, and the migration. The doctor fails when the processes alone exceed `max_connections` minus the 3 reserved connections, and both warn when a deployment can. New profile fields `dependencies.postgres.maxConnections` (default 100, rendered as `-c max_connections` for a PostgreSQL server PodoKit runs) and `dependencies.postgres.appPools` (application pools by the `runtimeConfig` key that caps them) feed the count. The Kubernetes `plan` now prints its warnings.

- [#239](https://github.com/podosoft-dev/podokit/pull/239) [`29708c8`](https://github.com/podosoft-dev/podokit/commit/29708c8f134442a3014961ef54f5474d14df1c68) Thanks [@korone00](https://github.com/korone00)! - Derive every proxy trust setting from one profile field, `exposure.edgeProxies`: the number of reverse proxies in front of the deployment (new Kubernetes profiles 0, new Compose profiles 1). The renderers set `XFF_DEPTH` to `edgeProxies` + 1 behind a Kubernetes Ingress, `edgeProxies` for a NodePort or a directly published Compose web service, and 1 behind the Compose gateway; `ADDRESS_HEADER`, `PROTOCOL_HEADER`, and `HOST_HEADER` only behind a proxy; and `TRUSTED_PROXY_HOPS` 1 for the API. `runtimeConfig` now refuses `ADDRESS_HEADER`, `XFF_DEPTH`, `TRUSTED_PROXY_HOPS`, and `TRUSTED_PROXY_HEADER`. Compose deployments behind a proxy now trust `X-Forwarded-Proto` and `X-Forwarded-Host`, which the guide told them to enable through keys the profile refused, and a NodePort profile without edge proxies stops trusting forwarded headers. `podo deploy doctor` warns when `edgeProxies`, `trustedProxyCidrs`, and direct paths contradict each other.

- [#240](https://github.com/podosoft-dev/podokit/pull/240) [`c3e309d`](https://github.com/podosoft-dev/podokit/commit/c3e309db8ac10d8f134db4bd79e3220f11163845) Thanks [@korone00](https://github.com/korone00)! - Proxy the exact `webSocketPaths` of `.podokit/dev.json` to the API from the Vite dev server, so a WebSocket endpoint works under `bun run dev` the way it does behind the `podo dev` gateway and a deployment's edge, without a proxy entry of the application's own.

- [#242](https://github.com/podosoft-dev/podokit/pull/242) [`f11eb24`](https://github.com/podosoft-dev/podokit/commit/f11eb24fb3b43a76c9dfec705224574530355512) Thanks [@korone00](https://github.com/korone00)! - Add `podo diff <path...>`, which shows a file's line diff against its template (owned files included), and `podo restore <path...>`, which rewrites managed files from the template and hands ejected files back to PodoKit so updates manage them again.

- [#242](https://github.com/podosoft-dev/podokit/pull/242) [`f11eb24`](https://github.com/podosoft-dev/podokit/commit/f11eb24fb3b43a76c9dfec705224574530355512) Thanks [@korone00](https://github.com/korone00)! - Add application-owned e2e seams: `tests/helpers/app-paths.ts` (first screen and its locator, indexable public pages, the pages with the site footer and the account menu) and, with `admin-dashboard`, `tests/helpers/app-accounts.ts` for the seeded accounts, with `E2E_ADMIN_EMAIL` and `E2E_USER_EMAIL` overrides. Managed specs read them instead of assuming the generated landing page, login footer, and `admin@example.com`/`user@example.com`, and `SiteFooter` carries `data-testid="site-footer"`.

- [#240](https://github.com/podosoft-dev/podokit/pull/240) [`c3e309d`](https://github.com/podosoft-dev/podokit/commit/c3e309db8ac10d8f134db4bd79e3220f11163845) Thanks [@korone00](https://github.com/korone00)! - Send the API the public origin a request came in on. The `/api` proxy and the server-side API client set `x-forwarded-host` and `x-forwarded-proto` from the request URL SvelteKit resolved, only when `CORS_ORIGIN` lists that origin, so an API route can build links for the origin a visitor used without trusting a header a caller wrote.

- [#242](https://github.com/podosoft-dev/podokit/pull/242) [`f11eb24`](https://github.com/podosoft-dev/podokit/commit/f11eb24fb3b43a76c9dfec705224574530355512) Thanks [@korone00](https://github.com/korone00)! - Keep PodoKit's own agent skills (`.claude/skills/podokit-*` and `.agents/skills/podokit-*`) managed so `podo update` brings their corrected commands and APIs; skills under other names stay owned.

- [#241](https://github.com/podosoft-dev/podokit/pull/241) [`9b5322b`](https://github.com/podosoft-dev/podokit/commit/9b5322bc5e4f2cea726dd62929cce0470eb3b14d) Thanks [@korone00](https://github.com/korone00)! - Stop losing migrations between the build and the database. The API build pins compiled migrations to `dist/migrations/<file>.js`, removes stale ones, fails unless the output matches `src/migrations` with one migration class per file, and writes `dist/migrations/migrations.json`. In production the migrators run exactly the listed files, refuse to run without the list, and fail when they load fewer migrations than expected; the API refuses to start without the list, and `GET /health/ready` reports a `migrations` check that stays down while a listed migration is missing from the database. `bun run migrate:list` prints the migrations a build would run, without a database.

- [#240](https://github.com/podosoft-dev/podokit/pull/240) [`c3e309d`](https://github.com/podosoft-dev/podokit/commit/c3e309db8ac10d8f134db4bd79e3220f11163845) Thanks [@korone00](https://github.com/korone00)! - Mark the light theme on `<html>`. `site-runtime.svelte` now gives mode-watcher `lightClassNames={["light"]}`, so `<html>` carries `light` in light mode as it carries `dark` in dark mode, and component libraries that follow either class and otherwise fall back to the system setting match the chosen theme.

- [#242](https://github.com/podosoft-dev/podokit/pull/242) [`f11eb24`](https://github.com/podosoft-dev/podokit/commit/f11eb24fb3b43a76c9dfec705224574530355512) Thanks [@korone00](https://github.com/korone00)! - Make `README.md`, `tests/README.md`, `.gitignore`, `.env.example`, `.env.docker.example`, and `infra/k3s/**` owned seeds: applications rewrite them, so `podo update` now reports their template changes for review instead of merging them, and a deleted `infra/k3s/` stays deleted.

- [#242](https://github.com/podosoft-dev/podokit/pull/242) [`f11eb24`](https://github.com/podosoft-dev/podokit/commit/f11eb24fb3b43a76c9dfec705224574530355512) Thanks [@korone00](https://github.com/korone00)! - Report owned files whose template changed as `review` in `podo update`, without writing them, and print the upstream diff with `--from <previous templates>`. The lock now records the template each owned file came from.

- [#238](https://github.com/podosoft-dev/podokit/pull/238) [`a514856`](https://github.com/podosoft-dev/podokit/commit/a514856c2b2434bbd6904d33caff8206652a2bff) Thanks [@korone00](https://github.com/korone00)! - Let generated apps run their Playwright suite on more than one worker. `E2E_WORKERS` sets the worker count (default 1), for example `E2E_WORKERS=2 bun run test:e2e`. Tests tagged `@exclusive`, which change state the other tests rely on, run in `<project>-exclusive` twins on one worker, and with more than one worker after every other test, one twin after another. The managed specs that change feature flags, the authentication configuration, the site settings, module settings such as analytics, or the seeded administrator's profile carry the tag, and projects from `tests/playwright.projects.cjs` get twins too. `test:e2e:api` and `test:e2e:ui` include the twins, and the global setup refuses `--workers` above 1 unless `E2E_WORKERS` is set. The `exclusive()` lock helper and its self-test are removed: its locks kept apart only the specs that changed the same setting, not the specs that relied on the default.

- [#241](https://github.com/podosoft-dev/podokit/pull/241) [`9b5322b`](https://github.com/podosoft-dev/podokit/commit/9b5322bc5e4f2cea726dd62929cce0470eb3b14d) Thanks [@korone00](https://github.com/korone00)! - Repeat jobs through the jobs contract. `JobQueue.schedule(id, name, payload, { cron | everyMs, timezone? })` adds a job on a cron expression or a fixed interval and replaces an earlier schedule with the same id, and `unschedule(id)` stops it. The BullMQ provider stores the schedules as Redis job schedulers and the local provider adds the jobs from a timer, once per time; both apply their schedules again when the connection is restored, resolve `schedule()` while the backend is down, and reject an invalid schedule. The runtime package exports `RepeatOptions`, `assertRepeatOptions()`, and `MIN_REPEAT_INTERVAL_MS`. Implementations of `JobQueue`, including test fakes, need the two new methods.

- [#241](https://github.com/podosoft-dev/podokit/pull/241) [`9b5322b`](https://github.com/podosoft-dev/podokit/commit/9b5322bc5e4f2cea726dd62929cce0470eb3b14d) Thanks [@korone00](https://github.com/korone00)! - Select a provider when the API starts. `DATABASE_PROVIDER`, `CACHE_PROVIDER`, `OBJECT_STORAGE_PROVIDER`, `EVENTS_PROVIDER`, and `JOBS_PROVIDER` replace the project's provider for one capability, so one build can run on PostgreSQL on a server and SQLite in a desktop shell without editing the managed `providers.ts`. An unknown value, or a provider whose module is not installed, fails startup. `providers.ts` now passes the project's selection through `providersFromEnvironment()` from the new `config/provider-selection.ts`, and `podo provider set` renders it the same way.

- [#240](https://github.com/podosoft-dev/podokit/pull/240) [`c3e309d`](https://github.com/podosoft-dev/podokit/commit/c3e309db8ac10d8f134db4bd79e3220f11163845) Thanks [@korone00](https://github.com/korone00)! - Let `sidebar-user-menu.svelte` render outside the admin sidebar. Inside a `Sidebar.Provider` it stays the sidebar menu item; elsewhere it renders the shell-independent `AccountMenu` identity block with the same account and sign-out actions instead of failing on the missing sidebar state.

- [#240](https://github.com/podosoft-dev/podokit/pull/240) [`c3e309d`](https://github.com/podosoft-dev/podokit/commit/c3e309db8ac10d8f134db4bd79e3220f11163845) Thanks [@korone00](https://github.com/korone00)! - Add application-owned extension points to the web app so applications stop editing managed files. `apps/web/vite.extensions.ts` holds Vite options (`appViteConfig`, merged with `mergeConfig`) and SvelteKit options (`appSvelteKitConfig`). With `admin-dashboard`, `appHandle` in `apps/web/src/lib/server/app-hooks.ts` runs after `hooks.server.ts` loads the runtime context, `APP_ADMIN_NAV` in `apps/web/src/lib/admin/app-nav.ts` adds admin sidebar entries before module entries and Settings, and `APP_NON_INDEXABLE_PATHS` in `apps/web/src/lib/server/non-indexable-paths.ts` adds prefixes that answer with `X-Robots-Tag: noindex, nofollow`. `podo update` creates each file once and never overwrites it.

- [#241](https://github.com/podosoft-dev/podokit/pull/241) [`9b5322b`](https://github.com/podosoft-dev/podokit/commit/9b5322bc5e4f2cea726dd62929cce0470eb3b14d) Thanks [@korone00](https://github.com/korone00)! - Add the bullmq module's application-owned `apps/api/src/worker.extensions.ts`. `configureWorkers(setup)` returns the application's queues for the worker process, with optional BullMQ worker options, and releases what it opened through `setup.onClose` after the workers stop, so apps stop editing the managed `worker.module.ts` and `main-worker.ts`. `startWorkers()` is asynchronous and returns `{ workers, close }`; two workers for one queue fail at startup.

### Patch Changes

- [#240](https://github.com/podosoft-dev/podokit/pull/240) [`c3e309d`](https://github.com/podosoft-dev/podokit/commit/c3e309db8ac10d8f134db4bd79e3220f11163845) Thanks [@korone00](https://github.com/korone00)! - Render the `/account` impersonation banner in the managed `AccountPage` instead of the application-owned account page. The managed load returned the flag while only newly generated owned pages rendered the banner, so an update delivered half the feature. The load now returns `showImpersonationBanner`, the managed component shows the banner, the impersonation e2e spec opens `/account` itself instead of asserting where the owned users page navigates, and a repository test keeps owned pages beside managed loads from reading new fields.

- [#241](https://github.com/podosoft-dev/podokit/pull/241) [`9b5322b`](https://github.com/podosoft-dev/podokit/commit/9b5322bc5e4f2cea726dd62929cce0470eb3b14d) Thanks [@korone00](https://github.com/korone00)! - Record the audit log in apps that never set its toggle. With the audit-log module installed, an unset or empty `AUDIT_LOG_ENABLED` now means on, only `false` turns it off, and the admin Settings toggle still overrides both; before, a deployment without the variable and without a saved setting recorded nothing. The API logs one warning at startup while the audit log is off. `createConfigStore()` and `envAuthConfig()` in `@podosoft/podokit-auth` take a `defaults` object for values that neither a row nor the environment sets, and the auth module keeps them in `AUTH_CONFIG_DEFAULTS` (`apps/api/src/auth/auth-config-store.ts`), where the audit-log module adds `auditLog: true`.

- [#241](https://github.com/podosoft-dev/podokit/pull/241) [`9b5322b`](https://github.com/podosoft-dev/podokit/commit/9b5322bc5e4f2cea726dd62929cce0470eb3b14d) Thanks [@korone00](https://github.com/korone00)! - Accept an `http:` `BETTER_AUTH_URL` on a loopback address in production, such as an API a desktop shell runs on `127.0.0.1`, so apps stop editing the managed `auth-environment.ts`. Every other address still needs `https:`.

- [#241](https://github.com/podosoft-dev/podokit/pull/241) [`9b5322b`](https://github.com/podosoft-dev/podokit/commit/9b5322bc5e4f2cea726dd62929cce0470eb3b14d) Thanks [@korone00](https://github.com/korone00)! - Let sign-in work once `migrate:all` has run, even when the API started before it. Better Auth keeps a schema mismatch it found until a migration in the same process clears it, so an API that started on an empty database answered every sign-in with `500` until it restarted. While the auth instance holds a mismatch, the auth module rebuilds it at most every 2 seconds on a request, and the new instance checks the database again.

- [#239](https://github.com/podosoft-dev/podokit/pull/239) [`29708c8`](https://github.com/podosoft-dev/podokit/commit/29708c8f134442a3014961ef54f5474d14df1c68) Thanks [@korone00](https://github.com/korone00)! - Send web and API one client address from the Compose deployment gateway. Behind a proxy listed in `exposure.trustedProxyCidrs`, Caddy appended that proxy to `X-Forwarded-For`, so with `XFF_DEPTH=1` and `TRUSTED_PROXY_HOPS=1` web and API recorded the proxy's address for sessions, audit entries, and rate limits. Every gateway `reverse_proxy` now sets `header_up X-Forwarded-For {client_ip}`: the client behind a trusted proxy, the gateway's peer otherwise.

- [#239](https://github.com/podosoft-dev/podokit/pull/239) [`29708c8`](https://github.com/podosoft-dev/podokit/commit/29708c8f134442a3014961ef54f5474d14df1c68) Thanks [@korone00](https://github.com/korone00)! - Derive the rendered `CONNECTION_IDLE_TIMEOUT` and `API_IDLE_TIMEOUT` from the application's `APP_PROXY_TIMEOUTS` as well as `BACKEND_PROXY_TIMEOUT_MS`: `0` when an entry has `timeoutMs: null`, otherwise the longest wait's whole seconds plus 5. PodoKit reads `apps/web/src/lib/server/proxy-timeouts.ts` as text without running it, and `podo deploy plan` fails with the line it stopped at when an entry is not a literal. `podo deploy doctor` fails a `CONNECTION_IDLE_TIMEOUT` set in `runtimeConfig` that cannot cover the longest wait, since the web server would refuse to start, and warns about such an `API_IDLE_TIMEOUT`.

- [#242](https://github.com/podosoft-dev/podokit/pull/242) [`f11eb24`](https://github.com/podosoft-dev/podokit/commit/f11eb24fb3b43a76c9dfec705224574530355512) Thanks [@korone00](https://github.com/korone00)! - Set `CORS_ORIGIN` and `BETTER_AUTH_URL` for the development containers from `.podokit/dev.json` in `podo dev`, and render the generated files that name the development host from it, so a renamed host no longer breaks sign-in with an invalid origin.

- [#238](https://github.com/podosoft-dev/podokit/pull/238) [`a514856`](https://github.com/podosoft-dev/podokit/commit/a514856c2b2434bbd6904d33caff8206652a2bff) Thanks [@korone00](https://github.com/korone00)! - Keep the generated e2e specs from depending on data other tests change at the same time. `clearMailpit()` and `clearSms()` are removed, because emptying the shared Mailpit inbox or SMS sink lost the messages other tests were waiting for; every spec already mails and texts recipients of its own. The organization spec picks the seeded user as a manager instead of the first user listed, and the blog comment validation spec posts to a post of its own.

- [#242](https://github.com/podosoft-dev/podokit/pull/242) [`f11eb24`](https://github.com/podosoft-dev/podokit/commit/f11eb24fb3b43a76c9dfec705224574530355512) Thanks [@korone00](https://github.com/korone00)! - Keep the generated account sessions specs and the `rate-limit` spec from spending the per-address sign-in budget: only their first sign-in or sign-up is anonymous, and the rest carry that session, which the rate limiter counts on its own.

- [#242](https://github.com/podosoft-dev/podokit/pull/242) [`f11eb24`](https://github.com/podosoft-dev/podokit/commit/f11eb24fb3b43a76c9dfec705224574530355512) Thanks [@korone00](https://github.com/korone00)! - Make the generated passkey spec check that signing out worked and that the passkey signed the user back in, instead of relying on the owned login page to expose a failed sign-out.

- [#242](https://github.com/podosoft-dev/podokit/pull/242) [`f11eb24`](https://github.com/podosoft-dev/podokit/commit/f11eb24fb3b43a76c9dfec705224574530355512) Thanks [@korone00](https://github.com/korone00)! - Pin the development Silo and `mc` images by digest and stop the bucket setup on the first error (`sh -e`, `mc mb --ignore-existing`) in `compose.dev.yaml` and the `object-storage-s3` compose overlay, so a bucket that cannot be created fails at startup.

- [#235](https://github.com/podosoft-dev/podokit/pull/235) [`d82149e`](https://github.com/podosoft-dev/podokit/commit/d82149e50ce41ff8b4c24553766bf45b883bdc85) Thanks [@korone00](https://github.com/korone00)! - Keep the `/api` proxy from cutting a request without a deadline after 300 seconds. Bun's `fetch` gave up on a silent API connection after its idle timeout (`BUN_CONFIG_HTTP_IDLE_TIMEOUT`, 300 seconds by default) even when `APP_PROXY_TIMEOUTS` set `timeoutMs: null`, and the browser got `503` `BACKEND_UNAVAILABLE` although the API was still working. The managed `backend-proxy.ts` now turns that timeout off for a route without a deadline and for a deadline of 300 seconds or more, so the deadline, the `GET /health` checks, and the browser alone end the wait; shorter deadlines keep Bun's default.

- [#242](https://github.com/podosoft-dev/podokit/pull/242) [`f11eb24`](https://github.com/podosoft-dev/podokit/commit/f11eb24fb3b43a76c9dfec705224574530355512) Thanks [@korone00](https://github.com/korone00)! - Refuse `podo update --apply`, and warn in the dry run, when an installed external module is older than the version the project last applied, instead of silently downgrading its files.

- [#241](https://github.com/podosoft-dev/podokit/pull/241) [`9b5322b`](https://github.com/podosoft-dev/podokit/commit/9b5322bc5e4f2cea726dd62929cce0470eb3b14d) Thanks [@korone00](https://github.com/korone00)! - Read `NODE_ENV` at run time in the built API. `Bun.build` replaced `process.env.NODE_ENV` with `"development"` in every bundle, so production images loaded the development-only `pino-pretty` transport, skipped the production checks on `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`, ran no SQLite migrations, and left dependencies on their development branches. `scripts/build.mjs` now keeps `process.env.NODE_ENV` a runtime read for the API, worker, and migration bundles, and the logging module reads the validated `NODE_ENV`.

- [#240](https://github.com/podosoft-dev/podokit/pull/240) [`c3e309d`](https://github.com/podosoft-dev/podokit/commit/c3e309db8ac10d8f134db4bd79e3220f11163845) Thanks [@korone00](https://github.com/korone00)! - Add a generated e2e spec, `tests/ui/same-origin-requests.ui.spec.ts`, that sends a `FormData` upload, a form-encoded body, and `POST` and `DELETE` requests without a body from the browser through the `/api` proxy and checks that each reaches the API with the page's `Origin`. The deployment guide explains the 403 "Cross-site POST form submissions are forbidden" such requests get when the web server resolves another origin than the browser, usually an ingress that replaces a TLS proxy's `X-Forwarded-Proto`, and why the fix belongs in the proxy configuration rather than in the client.

- [#242](https://github.com/podosoft-dev/podokit/pull/242) [`f11eb24`](https://github.com/podosoft-dev/podokit/commit/f11eb24fb3b43a76c9dfec705224574530355512) Thanks [@korone00](https://github.com/korone00)! - Sort the root `package.json` dependency section that external modules are listed in, as Bun and npm write it, so an app with two or more external modules no longer shows that file as edited.

- [#242](https://github.com/podosoft-dev/podokit/pull/242) [`f11eb24`](https://github.com/podosoft-dev/podokit/commit/f11eb24fb3b43a76c9dfec705224574530355512) Thanks [@korone00](https://github.com/korone00)! - Remove the account the generated users-admin spec creates if a normal user's create-user request wrongly succeeds.
- Updated dependencies [[`9b5322b`](https://github.com/podosoft-dev/podokit/commit/9b5322bc5e4f2cea726dd62929cce0470eb3b14d)]:
  - @podosoft/podokit-runtime@0.5.0

## 1.5.0

### Minor Changes

- [#232](https://github.com/podosoft-dev/podokit/pull/232) [`28acd36`](https://github.com/podosoft-dev/podokit/commit/28acd3693205038c3ebaefa8e95d0c4ae452aca4) Thanks [@korone00](https://github.com/korone00)! - Path prefixes in the rate-limit module's route profiles (`RATE_LIMIT_ROUTES`), `APP_BODY_LIMITS`, and `APP_PROXY_TIMEOUTS` take `:name` parameters that match exactly one non-empty path segment, such as `/hosts/:hostId/file-transfers` on the API and `/api/hosts/:hostId/file-transfers` on the web proxy. The most specific prefix wins: more segments, then, from the left, a literal segment over a parameter, then the existing tie-breakers. Wildcards, `.` or `..` segments, and malformed names are rejected, and the web lists reject two prefixes that cover the same paths.

- [#232](https://github.com/podosoft-dev/podokit/pull/232) [`28acd36`](https://github.com/podosoft-dev/podokit/commit/28acd3693205038c3ebaefa8e95d0c4ae452aca4) Thanks [@korone00](https://github.com/korone00)! - Let apps set the `/api` proxy's response deadline per route. Generated apps get an application-owned `apps/web/src/lib/server/proxy-timeouts.ts` with `APP_PROXY_TIMEOUTS` (`{ pathPrefix, timeoutMs }` entries under `/api/`, longest prefix wins, `null` for no deadline), which the managed `backend-proxy.ts` uses instead of `BACKEND_PROXY_TIMEOUT_MS`. The proxy repeats its `GET /health` check while it waits, so a route without a deadline still fails with `503` `BACKEND_UNAVAILABLE` when the API stops answering. `podo update` creates the file once in existing apps and never overwrites it.

- [#232](https://github.com/podosoft-dev/podokit/pull/232) [`28acd36`](https://github.com/podosoft-dev/podokit/commit/28acd3693205038c3ebaefa8e95d0c4ae452aca4) Thanks [@korone00](https://github.com/korone00)! - Count signed-in callers per user in the rate-limit module. Each API process learns the user of every session that authentication resolves for a request, through a new `RESOLVED_SESSIONS` registry in the generated API core that the auth module reports to, and keys that caller's counter by user until the session expires, so one user's sessions on several devices, addresses, or replicas share one budget. The limiter still reads no session from the database and makes no extra Redis call; a session the process has not resolved yet keeps its own counter, API keys still come first, and forged sessions still count by client address.

- [#232](https://github.com/podosoft-dev/podokit/pull/232) [`28acd36`](https://github.com/podosoft-dev/podokit/commit/28acd3693205038c3ebaefa8e95d0c4ae452aca4) Thanks [@korone00](https://github.com/korone00)! - Stop trusting a caller-controlled header for client addresses. The generated API resolves each request's address once, from the socket peer and `TRUSTED_PROXY_HOPS` / `TRUSTED_PROXY_HEADER` (formerly the rate-limit module's `RATE_LIMIT_TRUSTED_PROXY_HOPS` / `RATE_LIMIT_PROXY_HEADER`, now refused), records it in the `x-podokit-client-address` request header over any value the caller sent, and uses it for Better Auth sessions and limits, audit entries, and rate limits. The audit-log module stored `X-Forwarded-For` as received, so a caller could write any address into the audit trail. Generated configuration and new deployment profiles set `TRUSTED_PROXY_HOPS=1` for the web proxy or gateway in front of the API.

### Patch Changes

- [#232](https://github.com/podosoft-dev/podokit/pull/232) [`28acd36`](https://github.com/podosoft-dev/podokit/commit/28acd3693205038c3ebaefa8e95d0c4ae452aca4) Thanks [@korone00](https://github.com/korone00)! - Show every session on the account page's Sessions tab. Better Auth's `GET /api/auth/list-sessions` returns at most 100 sessions, so a user with more could see no "Current" row. The admin dashboard adds `GET /account/sessions` (the caller's own sessions, keyset-paged, the current one on every page, no tokens, Better Auth's freshness rule kept) and `DELETE /account/sessions/{id}` (revokes through Better Auth's audited `/revoke-session`), and the account page uses them.

- [#232](https://github.com/podosoft-dev/podokit/pull/232) [`28acd36`](https://github.com/podosoft-dev/podokit/commit/28acd3693205038c3ebaefa8e95d0c4ae452aca4) Thanks [@korone00](https://github.com/korone00)! - Keep the generated API from closing a slow request before the web proxy's deadline. The API's idle timeout defaults to 35 seconds instead of Elysia's 30 and comes from the new `API_IDLE_TIMEOUT` (0 to 255, 0 turns it off), which `apiServerOptions.idleTimeout` still overrides. Bun checks idle connections every 4 seconds, so 30 cut endpoints that answered after 28 to 30 seconds and every longer `APP_PROXY_TIMEOUTS` route. The Compose and Kubernetes renderers derive `API_IDLE_TIMEOUT` from `BACKEND_PROXY_TIMEOUT_MS` like `CONNECTION_IDLE_TIMEOUT`.

- [#232](https://github.com/podosoft-dev/podokit/pull/232) [`28acd36`](https://github.com/podosoft-dev/podokit/commit/28acd3693205038c3ebaefa8e95d0c4ae452aca4) Thanks [@korone00](https://github.com/korone00)! - Keep the API type-checking after `podo provider set ... --apply`. The generated `apps/api/src/config/providers.ts` now declares `PROVIDERS` as `Readonly<ProviderSelections>` instead of `as const`, so the previous provider's module, which stays installed and inactive for a rollback, no longer fails `tsc` (TS2367) on its own selection check after a cache, object storage, events, or jobs switch.

- [#232](https://github.com/podosoft-dev/podokit/pull/232) [`28acd36`](https://github.com/podosoft-dev/podokit/commit/28acd3693205038c3ebaefa8e95d0c4ae452aca4) Thanks [@korone00](https://github.com/korone00)! - Make "sign out other sessions" revoke every other session. Better Auth's `POST /api/auth/revoke-other-sessions` lists sessions through the adapter's default limit of 100 and revoked only those; the auth module's new `revokeEveryOtherSession` plugin revokes the rest in batches through Better Auth's internal adapter, including secondary-storage entries.

- [#232](https://github.com/podosoft-dev/podokit/pull/232) [`28acd36`](https://github.com/podosoft-dev/podokit/commit/28acd3693205038c3ebaefa8e95d0c4ae452aca4) Thanks [@korone00](https://github.com/korone00)! - Keep the admin dashboard's table search box usable on phones. At a 390 px viewport the input shrank to about 42 px between the search field select and the Search button; it now keeps at least 192 px and wraps to its own row with the button. Desktop layouts are unchanged.

- [#232](https://github.com/podosoft-dev/podokit/pull/232) [`28acd36`](https://github.com/podosoft-dev/podokit/commit/28acd3693205038c3ebaefa8e95d0c4ae452aca4) Thanks [@korone00](https://github.com/korone00)! - Bring the `todo` template's `AGENTS.md` in line with the `fullstack` guide it extends: it now covers the web server's `GET /healthz` route, the API timeouts, `apiServerOptions` with its environment fallbacks, and `podo dev`, including that `podo dev down` also stops `podo dev watch`.

- [#232](https://github.com/podosoft-dev/podokit/pull/232) [`28acd36`](https://github.com/podosoft-dev/podokit/commit/28acd3693205038c3ebaefa8e95d0c4ae452aca4) Thanks [@korone00](https://github.com/korone00)! - Keep the built web server from closing proxied requests before the `/api` proxy's deadline. The web image, `.env.example`, reference Kubernetes config, and the Compose and Kubernetes deployment renders set adapter-bun's `CONNECTION_IDLE_TIMEOUT` to 35 seconds instead of Bun's default of 10, which cut a request whose API answer took longer with an empty reply after 8 to 12 seconds. The renderers derive the value from the profile's `BACKEND_PROXY_TIMEOUT_MS` unless `runtimeConfig` sets it, and the proxy refuses to load when a set value is not more than 4 seconds above `BACKEND_PROXY_TIMEOUT_MS` and every `APP_PROXY_TIMEOUTS` entry, or `0`, since Bun checks idle connections every 4 seconds.
- Updated dependencies [[`28acd36`](https://github.com/podosoft-dev/podokit/commit/28acd3693205038c3ebaefa8e95d0c4ae452aca4)]:
  - @podosoft/podokit-runtime@0.4.1

## 1.4.2

### Patch Changes

- [#229](https://github.com/podosoft-dev/podokit/pull/229) [`697e738`](https://github.com/podosoft-dev/podokit/commit/697e738faaf858d032febc81a721c41f014f17f3) Thanks [@korone00](https://github.com/korone00)! - `isDatabaseUnavailable` also recognizes a database host that does not resolve (`ENOTFOUND`) or whose lookup times out (`ETIMEOUT` in Bun, `EAI_AGAIN` in Node), pg's "Connection terminated", "Client was closed and is not queryable" and "Client has encountered a connection error and is not queryable", the per-address errors of an `AggregateError`, and the `driverError` of TypeORM's `QueryFailedError`, so those failures answer 503 `DATABASE_UNAVAILABLE` instead of 500.

- [#229](https://github.com/podosoft-dev/podokit/pull/229) [`697e738`](https://github.com/podosoft-dev/podokit/commit/697e738faaf858d032febc81a721c41f014f17f3) Thanks [@korone00](https://github.com/korone00)! - The admin dashboard's Playwright specs that change a server-wide setting hold a lock shared by every worker on the machine, so a run with `--workers` above 1 no longer lets two specs flip the same setting at once: the `require2fa`, magic-link and OIDC provider flags, automatic logout, social sign-in providers, the General settings and the Appearance settings. A failing test releases its lock, and a lock left by a worker that exited is taken over at once.

- [#229](https://github.com/podosoft-dev/podokit/pull/229) [`697e738`](https://github.com/podosoft-dev/podokit/commit/697e738faaf858d032febc81a721c41f014f17f3) Thanks [@korone00](https://github.com/korone00)! - `.podokit/files.lock` never records local environment files such as `.env`, `.env.docker` or `apps/api/.env`, which Git ignores and which hold secrets; the committed `*.example` files are still recorded. `podo update` had written the hash of `.env.docker` into the lock, and after `podo add`, `podo remove` or `podo provider set` recorded `.env` as a managed file, the next `podo update` deleted it as removed upstream. Entries an earlier version wrote are ignored and dropped on the next lock write.

- [#229](https://github.com/podosoft-dev/podokit/pull/229) [`697e738`](https://github.com/podosoft-dev/podokit/commit/697e738faaf858d032febc81a721c41f014f17f3) Thanks [@korone00](https://github.com/korone00)! - `apps/api/scripts/run-migrations.mjs`, the launcher behind `migrate:all`, runs the migration in `apps/api` wherever it is started from. Bun reads decorator settings such as `experimentalDecorators` from the `tsconfig.json` of the working directory, so started from the repository root, TypeORM entities with decorators failed to load, and the data source looked for `.env` and the migrations in the wrong directory.

- [#229](https://github.com/podosoft-dev/podokit/pull/229) [`697e738`](https://github.com/podosoft-dev/podokit/commit/697e738faaf858d032febc81a721c41f014f17f3) Thanks [@korone00](https://github.com/korone00)! - With the OIDC provider turned off in the admin settings, its discovery documents (`/api/auth/.well-known/openid-configuration` and `/api/auth/.well-known/oauth-authorization-server`, including the RFC 8414 form outside the base path) answer 404 like the provider's other endpoints. The provider served them from its own request hook, which runs before the feature gate, so they stayed public. The auth module now registers the feature gate as the first Better Auth plugin as well; the `jwt` plugin's `/api/auth/jwks` and `/api/auth/token` stay available.

- [#229](https://github.com/podosoft-dev/podokit/pull/229) [`697e738`](https://github.com/podosoft-dev/podokit/commit/697e738faaf858d032febc81a721c41f014f17f3) Thanks [@korone00](https://github.com/korone00)! - The admin dashboard's `oidc.ui.spec.ts` reads the JWKS through the app under test. It requested discovery's `jwks_uri` directly, which fails when `BETTER_AUTH_URL` is a public origin the runner cannot use, such as a tunnel set as `publicUrl` in `.podokit/dev.json` that answers with an access login page; it now checks that `jwks_uri` has the issuer's origin and requests its path from the tested app.

- [#229](https://github.com/podosoft-dev/podokit/pull/229) [`697e738`](https://github.com/podosoft-dev/podokit/commit/697e738faaf858d032febc81a721c41f014f17f3) Thanks [@korone00](https://github.com/korone00)! - The admin dashboard's `request-budget.ui.spec.ts` reads each `__data.json` body through `page.route` instead of `response.text()`. Chromium can report the fetch as aborted (`net::ERR_ABORTED`) once SvelteKit has consumed the body and then keeps no body, so the spec failed with "No data found for resource" even though the page had its data.

- [#229](https://github.com/podosoft-dev/podokit/pull/229) [`697e738`](https://github.com/podosoft-dev/podokit/commit/697e738faaf858d032febc81a721c41f014f17f3) Thanks [@korone00](https://github.com/korone00)! - Generated web apps no longer wait on an API that stops answering. Each server-side API call gives up after `BACKEND_TIMEOUT_MS` (2000 ms), and the `/api` proxy answers `504` `BACKEND_TIMEOUT` when no response headers arrive within `BACKEND_PROXY_TIMEOUT_MS` (30000 ms), or `503` `BACKEND_UNAVAILABLE` with `Retry-After: 2` instead of a bare `500` when it cannot reach the API. Once the API's `GET /health` does not answer either, waiting requests fail and new ones fail at once until the API answers again.

- [#229](https://github.com/podosoft-dev/podokit/pull/229) [`697e738`](https://github.com/podosoft-dev/podokit/commit/697e738faaf858d032febc81a721c41f014f17f3) Thanks [@korone00](https://github.com/korone00)! - Generated web apps answer `GET /healthz` without calling the API, and the rendered Kubernetes probes (now with `timeoutSeconds: 2`), the Compose healthcheck, and the web image's `HEALTHCHECK` request it instead of `/`, so an API outage no longer takes the web pods out of service or restarts them. `podo update` adds the route and updates the web `Dockerfile`; deploy a release built from the updated app.

## 1.4.1

### Patch Changes

- [#225](https://github.com/podosoft-dev/podokit/pull/225) [`76ac9ea`](https://github.com/podosoft-dev/podokit/commit/76ac9ea4ec3f757e94aa874424695ccaff8f3b92) Thanks [@korone00](https://github.com/korone00)! - Let the file-upload module's `tests/api/chunked-uploads.api.spec.ts` pass on a containerized dev stack. It downloaded the completed object through the S3 presigned URL, which the API signs for its own S3 endpoint; on a container stack that is an in-network host such as `minio`, so a host-side runner failed with `getaddrinfo EAI_AGAIN minio`. Like the S3 storage spec, it now downloads from S3 and checks the SHA-256 only when the runner has `S3_ENDPOINT`, and always downloads the signed API path that local storage returns. The completed size it checks comes from the stored object either way.

- [#227](https://github.com/podosoft-dev/podokit/pull/227) [`105e274`](https://github.com/podosoft-dev/podokit/commit/105e2748c0639cd8ef192adc26619c955064c65a) Thanks [@korone00](https://github.com/korone00)! - `isDatabaseUnavailable` also treats refused, reset and unreachable connections, pg's "Connection terminated unexpectedly", and the server-shutdown and connection-exception SQLSTATEs (57P01, 57P02, 57P03, class 08) as the database being unavailable, so those failures answer 503 `DATABASE_UNAVAILABLE` instead of 500.

- [#225](https://github.com/podosoft-dev/podokit/pull/225) [`76ac9ea`](https://github.com/podosoft-dev/podokit/commit/76ac9ea4ec3f757e94aa874424695ccaff8f3b92) Thanks [@korone00](https://github.com/korone00)! - Make `migrate:all` the one migration command for every generated app and stop `migration:run` from failing obscurely on a new database. The admin dashboard's session index migration (`IndexSessionCreatedAt1792060000000`) needs Better Auth's `session` table, which only `migrate:all` creates, so `migration:run` on a new PostgreSQL or SQLite database failed with `relation "session" does not exist`. The migration now checks for the table first and stops with a message that names `bun run --cwd apps/api migrate:all`; it never records itself without building the index. The base template owns the `apps/api/scripts/run-migrations.mjs` launcher behind `migrate:all`, which runs the source in development and the compiled output in a production image, and prefers the auth module's `src/migrate.ts`, which applies the Better Auth schema first. Apps without auth can therefore run `migrate:all` before a build. Generated READMEs, AGENTS.md, module instructions, and the docs now set up and migrate with `migrate:all`. `podo update` adds the launcher to existing apps and replaces the auth module's copy in place.

- [#225](https://github.com/podosoft-dev/podokit/pull/225) [`76ac9ea`](https://github.com/podosoft-dev/podokit/commit/76ac9ea4ec3f757e94aa874424695ccaff8f3b92) Thanks [@korone00](https://github.com/korone00)! - Make the generated `apps/api/src/database/pool-guard.spec.ts` type-check with every `@types/bun` version the template allows. With `@types/bun` 1.3.9 through 1.4.2, the `expect()` overload for a missing value made TypeScript infer two awaited queries as `undefined`, so `bun run lint` failed in new apps. The two queries now declare their row types.

- [#225](https://github.com/podosoft-dev/podokit/pull/225) [`76ac9ea`](https://github.com/podosoft-dev/podokit/commit/76ac9ea4ec3f757e94aa874424695ccaff8f3b92) Thanks [@korone00](https://github.com/korone00)! - Give generated web apps their own fallback error page. When the root layout or a server hook fails, such as with 503 while the API is down, SvelteKit served its built-in page because the template had no `apps/web/src/error.html`. The template now ships a self-contained, application-owned `error.html` with inline styles for light and dark color schemes, a viewport, and only the `%sveltekit.status%` and `%sveltekit.error.message%` placeholders, so it needs no translations. `podo update` creates it once in existing apps and never overwrites it, including an `error.html` an app already has.

## 1.4.0

### Minor Changes

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - Let applications set the API's Bun server options. The managed `main.ts` passes the optional `apiServerOptions` export of the owned `app.extensions.ts` (`maxRequestBodySize`, `idleTimeout`, or a function of the validated environment) to `app.listen`, and `API_MAX_REQUEST_BODY_SIZE` sets the request body limit when the export leaves it out (default 128 MiB, Bun's default). Extension files from earlier releases, which lack the export, keep compiling.

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - Let apps pass their own headers through the `/api` proxy. Generated apps get an application-owned `apps/web/src/lib/server/proxy-headers.ts` with `APP_FORWARDED_REQUEST_HEADERS` and `APP_RELAYED_RESPONSE_HEADERS`, which the managed `backend-proxy.ts` merges into its allowlists (lowercased, deduplicated, and rejecting hop-by-hop, framing, `host`, `set-cookie`, and client address headers). `podo update` creates the file once in existing apps and never overwrites it.

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - Give fresh clones a container environment without committing secrets. Generated apps ship a committed `.env.docker.example` (with an empty `BETTER_AUTH_SECRET`) and a `.gitignore` exception for it instead of an ignored `.env.docker`, so a clone used to fail with "env file .env.docker not found". Every `podo dev` command except `url` creates the untracked `.env.docker` from the example when it is missing and fills each empty `*_SECRET` value with a random one; an existing `.env.docker` is never changed. `podo dev env` does only that step, and the devcontainer runs it as its `initializeCommand`. `podo update --apply` adds the example and the `.gitignore` exception to existing apps and keeps their `.env.docker`.

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - Route listed API paths past the web proxy. `exposure.apiPaths` in deployment profiles and `apiPaths` in `.podokit/dev.json` send static prefixes under `/api/` straight to the API with `/api` removed, through a second Traefik Ingress with a `stripPrefix` Middleware on Kubernetes, the Caddy gateway on Docker Compose, and the shared Traefik gateway in `podo dev`, so large uploads are no longer capped by the web server's `BODY_SIZE_LIMIT`. `podo dev` also renders one Traefik matcher per WebSocket path, which Traefik v3 requires.

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - Add resumable chunked uploads to the file-upload module. `POST /files/uploads`, `PUT /files/uploads/{id}/parts/{partNumber}`, `GET /files/uploads/{id}`, `POST /files/uploads/{id}/complete`, and `DELETE /files/uploads/{id}` stream parts into an object storage multipart upload, keep every session in the database (`file_upload_sessions`, `file_upload_parts`) with conditional state transitions and an expiry sweep so any API replica can serve an upload, answer other users with 404, require JSON or binary content types (415 `UNSUPPORTED_MEDIA_TYPE`), reject browser origins outside `CORS_ORIGIN`, and register a `file-uploads` rate-limit budget for parts. `FILE_UPLOAD_MAX_BYTES`, `FILE_UPLOAD_PART_BYTES`, `FILE_UPLOAD_SESSION_TTL`, `FILE_UPLOAD_SWEEP_INTERVAL`, and `FILE_UPLOAD_RATE_LIMIT_MAX` configure it, and the managed `$lib/uploads` web helper uploads and resumes files with retries, byte-level progress (parts go out with `XMLHttpRequest` in the browser), and cancellation. The module declares `/api/files/uploads/` as a direct API path, so parts bypass the web server's body limit.

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - Let modules declare direct API paths. A manifest v4 module lists prefixes under `/api/` in `apiPaths`, validated like `exposure.apiPaths`, and `podo add` appends them to `.podokit/dev.json` and to `exposure.apiPaths` in every deployment profile, keeping the other keys and the file's indentation, skipping paths an entry already covers, and reporting paths it cannot add (an overlap, a covered WebSocket path, or Kubernetes `nodePort` exposure) instead of writing an invalid file. The project manifest records them as the module's `appliedApiPaths`; `podo deploy init` copies them into new profiles, `podo remove` deletes the ones no other installed module declares, and `podo update` plans and applies the paths a newer module version adds. The `file-upload` module declares `/api/files/uploads/`.

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - Stream object writes and add multipart uploads. `ObjectBody` now includes `Blob` and `ReadableStream`, and `ObjectStore` gains `createMultipartUpload`, `uploadPart`, `completeMultipartUpload`, and `abortMultipartUpload`, with `MIN_MULTIPART_PART_BYTES`, `MAX_MULTIPART_PARTS`, `MultipartUploadError`, and the `objectBodyChunks`, `assertPartNumber`, and `normalizeCompletedParts` helpers. `LocalObjectStore` writes streamed bodies to a temporary file, keeps multipart parts under `.podokit/multipart/`, and removes idle uploads after `multipartMaxAgeMs`. The S3 module streams large bodies as multipart uploads with bounded memory, signs multipart requests with AWS Signature Version 4, and aborts an upload whose body fails; the local module adds `LOCAL_STORAGE_MULTIPART_MAX_AGE`. Custom `ObjectStore` implementations must add the four multipart methods.

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - Add rate-limit route profiles. The runtime exports `RATE_LIMIT_ROUTES` with the `RateLimitRoute`, `RateLimitProfile`, and `RateLimitRouteRegistry` contracts, and the rate-limit module registers the registry and re-exports the key. `register({ method?, pathPrefix, profile })` gives a path prefix its own budget (`{ name, limit, ttlSeconds? }`) or `"exempt"`; the most specific prefix wins, then a route with a method, then the latest registration. The general, authentication, and runtime budgets are now registered routes, with the same limits as before. Modules resolve the registry with `tryResolve`, so they work without rate limiting installed.

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - Load the session and site settings only for responses that can use them. The admin-dashboard `hooks.server.ts` now decides through the managed `#lib/server/runtime-context.ts`: pages, page data, form actions, remote functions, and SvelteKit's 404 page get both, while the `/api` proxy, a missing subresource, and prerendering skip both API calls. A signed-in visitor on a missing page no longer loops between the page and `/login`. An application-owned `apps/web/src/lib/server/asset-paths.ts` (`APP_ASSET_PATHS`) lists the prefixes of `+server.ts` endpoints that serve files or feeds; those endpoints answer without the two API calls, and a page under a listed prefix keeps its sign-in and maintenance checks. `podo update` creates the file once and never overwrites it.

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - Ship the shadcn-svelte `textarea` in the generated UI set at `apps/web/src/lib/components/ui/textarea`, vendored from the official registry for the template's `nova` style like the other primitives. `components.json` now maps the `utils`, `hooks`, and `lib` aliases to the `#lib` import map, so `bunx --bun shadcn-svelte@latest add <component>` works in a generated app; it stopped with an invalid `hooks` alias and wrote `#lib/utils.js.js` imports before. The blog and analytics modules no longer ship their own textarea copy, which `podo remove` could delete from under other pages; they declare the shared component as a required project file, so `podo add` asks an older project to run `podo update --apply` first.

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - Let apps cap request bodies per API route. Generated apps get an application-owned `apps/web/src/lib/server/body-limits.ts` with `APP_BODY_LIMITS` (`{ pathPrefix, maxBytes }` entries under `/api/`), which the managed `/api` proxy enforces by rejecting a larger `Content-Length` or counting a streamed body, answering 413 `PAYLOAD_TOO_LARGE` with the standard error envelope. `BODY_SIZE_LIMIT` remains the ceiling for every web route; uploads above it use direct API paths. `podo update` creates the file once in existing apps and never overwrites it.

### Patch Changes

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - Start the generated API while PostgreSQL is unreachable. The service registry gains `services.supervise(name, connection)`: startup makes one connection attempt, then the server listens and the registry reconnects in the background with backoff from 250 ms up to 5 seconds, logging once per state change. The core database and the `jobs-local` worker use it, so the API answers `/health` with 200 and `/health/ready` with 503 until the database is back and then becomes ready without a restart, instead of exiting with `ERR_POSTGRES_CONNECTION_REFUSED`. The `/health/ready` 503 message names the checks that are down.

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - Stop holding auth requests for a configuration refresh that PostgreSQL does not answer. The refresh that runs before Better Auth on a request waited as long as a query may wait during an outage, so sign-in answered `503` only after two timeouts. A request now waits for it at most `READINESS_CHECK_TIMEOUT_MS` and is served by the current configuration while the refresh finishes in the background.

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - Answer `503 DATABASE_UNAVAILABLE` from Better Auth endpoints while PostgreSQL is unreachable. `POST /api/auth/sign-in/email`, `GET /api/auth/get-session`, and session-protected routes answered `500`, because Better Auth reports a failed query as a bare `500` and its session lookup drops the cause. After a server error the auth module now checks its pool with `SELECT 1`, bounded by `READINESS_CHECK_TIMEOUT_MS`, and answers `503` only when that fails too; client errors and unrelated `500` errors are unchanged. Every `503` error envelope now carries `Retry-After: 1` unless the failing code set its own value.

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - Bound the auth module's PostgreSQL queries with `DB_QUERY_TIMEOUT_MS` (default `10000`). While PostgreSQL kept its connections open without answering, sign-in and session lookups waited indefinitely, and a connection whose query timed out would have been reused by Kysely behind the missing reply. The auth pool now fails such a query, discards its connection, and opens a new one, so Better Auth endpoints answer `503 DATABASE_UNAVAILABLE`. Migrations and `admin:bootstrap` import `./auth/maintenance-command` first, which replaces `./auth/skip-schema-validation`, and run without the timeout.

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - Fail BullMQ enqueues fast while Redis is unavailable. The API's queues used the workers' `maxRetriesPerRequest: null` connection settings, so `POST /jobs` and `POST /progress` waited until Redis returned. The API now adds and reads jobs over one supervised producer connection that fails at once while disconnected and after `REDIS_COMMAND_TIMEOUT_MS` without a reply, answering `503 JOBS_UNAVAILABLE` with `Retry-After`, and registers a `jobs` readiness check. Workers keep their blocking connections and reconnect with backoff from 250 ms up to 5 seconds. The `bullmq` module now requires BullMQ `^5.57.0`.

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - Recover the API's Bun SQL pool when PostgreSQL keeps its connections open without answering, as a paused container, a frozen VM, or a network partition does. Bun SQL has no query timeout and cannot close a single pool connection, so such queries waited until the server answered again. A query or transaction still pending after `DB_QUERY_TIMEOUT_MS` (default `10000`) now makes the API check the server on a new connection; when that check fails within `READINESS_CHECK_TIMEOUT_MS`, the API replaces the pool, the waiting requests answer `503 DATABASE_UNAVAILABLE`, and the supervisor logs the outage and its end. Slow queries on a server that still answers keep running, and migrations are not affected.

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - `podo dev down` stops the Compose Watch that `podo dev watch` started for the same project before removing the stack. The watch kept running after `down` and held Compose's per-project lock, so the next `podo dev watch` failed with "cannot take exclusive lock" until the process was killed by hand. The watch is found by the project's own `.podokit/runtime/dev.compose.yaml` path, so other projects' watches and the shared gateway are untouched, and the stopped `podo dev watch` exits successfully with "Stopped watching." instead of an error.

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - `podo dev up` passes `--build` to `docker compose up` unless `--build` or `--no-build` is given. Compose Watch syncs edits into running containers only, so when `up` recreated a container (after a memory limit or `.env.docker` change, even while `podo dev watch` was running) the new container started from the last built image and lost every synced edit.

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - The admin-dashboard `disposableUsers` Playwright fixture cleans up through its own request context in UI tests too, holding a copy of the browser's admin cookies. A UI test that signed its page in as another user used to turn cleanup into that user's requests, which failed with 403.

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - Tell SSE clients to reload after an event transport outage. The runtime `EventBus` contract gains an optional `onInterruption(listener)` that a transport calls when delivery resumes after an outage in which events may have been lost, and `subscribe` is documented to register handlers without waiting for the transport. The `sse` module sends one `resync` frame to every open stream when that happens, so clients refetch the state they missed while their stream stayed open.

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - Keep the `events-redis` transport delivering across Redis outages. The API starts while Redis is down, handlers register without waiting for Redis, and the registry reconnects the transport in the background and subscribes its channel again on a fresh connection after every drop, because Bun restores neither. SSE events and settings change events from other replicas arrive again once Redis is back, open SSE streams receive `resync`, publishing fails at once with 503 `EVENTS_TRANSPORT_UNAVAILABLE` while disconnected, and the `events` readiness check reports the transport down until it is subscribed.

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - Answer `HEAD` requests to routes that are public for `GET`. The API's `AccessPolicy` matched rules by exact method, so `HEAD /profile-images/:fileName` and `HEAD /site/favicon` answered `401` although their `GET` is public. A `HEAD` request now also matches `GET` rules, unless a later `HEAD` rule overrides them; Elysia answers it with the GET handler, so it carries the GET response's headers without the body.

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - Keep `Content-Length` for local objects up to 2 MiB. Bun keeps the length that `objectResponse` sets only for a body held in memory or read from a file, such as `new Blob([bytes]).stream()`, and sends any other `ReadableStream`, including a `fetch()` response body, chunked (oven-sh/bun#10507). `LocalObjectStore.get()` now reads objects up to the new `IN_MEMORY_READ_BYTES` (2 MiB) whole before it resolves, opening the file with `O_NOFOLLOW` and checking that the path still holds the described file before and after the read, and returns them as an in-memory body; a file replaced during that read is described again. Larger objects still stream in 64 KiB chunks from the first read and go out chunked. The `object-storage-s3` module now takes its 2 MiB limit from `IN_MEMORY_READ_BYTES`.

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - Keep `Content-Length` on responses relayed by the web app's `/api` proxy. Bun sends a streamed body, a `fetch()` response body included, with chunked encoding and drops the length once it is more than a few KiB, so profile images, favicons, and larger JSON responses reached the browser chunked even when the API sent their length. The managed `backend-proxy.ts` now reads an uncompressed body of up to 2 MiB (`IN_MEMORY_RESPONSE_BYTES`) with a known length before relaying it, and streams larger bodies through.

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - `E2E_SKIP_RATE_LIMIT=true` skips the rate-limit module's Playwright spec, so a local stack with raised limits can run the rest of the suite in one go and run that file separately against the default limits.

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - Bound every Redis command the API sends with `REDIS_COMMAND_TIMEOUT_MS` (default `1000`). While Redis kept the connection open without answering, as a paused container does, cache reads and writes through `RedisService` and the Redis `CACHE` store waited indefinitely and the connection still looked healthy. A command now fails with `RedisCommandTimeoutError`, and its connection is closed and reopened by the supervisor. The `events-redis` transport bounds publishing and its subscription the same way, the demo `/cache` endpoints answer `503 CACHE_UNAVAILABLE`, and `RedisService.command(...)` bounds commands the service does not wrap.

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - Keep the `redis` module working across Redis outages. The API starts while Redis is down, reconnects in the background, and recovers after a Redis restart without its own restart; before, it exited at startup with `RedisError: Connection closed`, and a running API stayed unready after Redis came back because the client stopped reconnecting. Commands fail at once while disconnected, so the rate limiter answers `RATE_LIMIT_UNAVAILABLE` instead of waiting, and `RedisService.subscribe` resolves without Redis and restores its subscriptions on a fresh connection after every reconnect. The `redis` readiness check is registered by the module from the start.

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - Read S3 objects with one request and keep the `Content-Length` of small ones. In the `object-storage-s3` module, `StorageService.open()`, which backs `OBJECT_STORAGE.get()`, sends one presigned GET instead of a HEAD followed by a GET with `If-Match`, takes the metadata from that response, and reads objects up to 2 MiB into memory, because Bun sends any other streamed body with chunked encoding and drops the length that `objectResponse` sets. Larger objects stream from the GET, which stays open until the body is read or cancelled. A missing bucket now throws instead of resolving `null`. The runtime's `ObjectData.body` documentation no longer promises a body that opens on its first read.
- Updated dependencies [[`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791), [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791), [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791), [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791), [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791)]:
  - @podosoft/podokit-runtime@0.4.0

## 1.3.0

### Minor Changes

- [#219](https://github.com/podosoft-dev/podokit/pull/219) [`77ad3b9`](https://github.com/podosoft-dev/podokit/commit/77ad3b9a895efa812588e56b62abdd3bb1fed79f) Thanks [@korone00](https://github.com/korone00)! - Fix the upgrade path to 1.2 and add admin, streaming, and public page improvements. `podo update` adds the module for the selected provider when a module gains a capability requirement (such as `sse` requiring `events`), lists it under "Modules to add", and moves a provider recorded after its dependents in front of them; `podo add` places a new provider ahead of the installed modules that need it. Template ranges for PodoKit packages name the current versions, so updated apps get `@podosoft/podokit-api-client` 0.8.5. `admin:bootstrap` loads a bundled runtime entry, works on PostgreSQL and SQLite, and reports why it cannot connect. The audit filter and new admin session list indexes build concurrently on PostgreSQL, with TypeORM migrations running one transaction each. On SQLite the auth configuration reports `enabled` as a boolean and a new session idle timeout applies without a syntax error. `SSE_MAX_STREAMS_PER_USER` caps a user's event streams per API replica (429 `EVENTS_STREAM_LIMIT`). `GET /admin/users` lists users with combined role and status filters, and the admin users page uses it. An app-owned `apps/web/src/lib/server/public-paths.ts` (`APP_PUBLIC_PATHS`) declares the app's own public pages, which `guards.ts` includes; `podo update` creates it once and never overwrites it. Several generated UI specs wait for hydration or read responses before navigating on, and the generated specs pass strict type checking.

## 1.2.0

### Minor Changes

- [#216](https://github.com/podosoft-dev/podokit/pull/216) [`99a1305`](https://github.com/podosoft-dev/podokit/commit/99a1305eb040745ba3bbfaab9427fb8320533da4) Thanks [@korone00](https://github.com/korone00)! - Make runtime settings and the audit log scale. The settings store probes `auth_config` and `app_setting` versions with one cheap query per tick and reloads only on change, detects deleted rows, memoizes derived settings and the secret key, and refreshes `SettingsService` across replicas (with immediate invalidation over the events bus when one is installed). Auth settings save on SQLite. The audit log honours its toggle on every write, can defer non-security writes, pages with a cursor and server-side filters, indexes those filters, stores metadata as JSON, and can prune entries after `AUDIT_LOG_RETENTION_DAYS`.

- [#215](https://github.com/podosoft-dev/podokit/pull/215) [`526c506`](https://github.com/podosoft-dev/podokit/commit/526c50657fc0f64f7b84ccf553f94b141904e2c6) Thanks [@korone00](https://github.com/korone00)! - Cut the fixed cost of every request in generated apps. Session reads no longer sign an unused JWT header, unsigned bearer values are rejected without a session lookup, and rate limiting keys signed sessions by a verified cookie hash instead of a database lookup. Server rendering loads site settings and the session together, memoizes capabilities per request, and stops resending the message catalog on client navigation. `Capabilities` gains `require2fa`. Site settings come from one cached query, the merged OpenAPI document is reused, the rate-limit script runs by SHA, and OAuth consent sends the signed authorization query.

- [#213](https://github.com/podosoft-dev/podokit/pull/213) [`5dacc53`](https://github.com/podosoft-dev/podokit/commit/5dacc5344fc007aa4499280e270fcd200cd1b44f) Thanks [@korone00](https://github.com/korone00)! - Harden generated apps at runtime. The web proxy now aborts the API request when the client disconnects, relays cache and download headers, and forwards encoded paths unchanged. Readiness re-checks the database on every probe with per-check timeouts and a short shared cache, and API probes get a two-second timeout. Database pool size and connection timeouts are configurable, and an exhausted pool answers 503 `DATABASE_UNAVAILABLE`. The container dev stack caps every service's memory. Demo storage routes are admin-only under a `demo/` prefix, uploads are presigned only for their uploader or an admin, and local downloads require a signed URL and never render script.

- [#217](https://github.com/podosoft-dev/podokit/pull/217) [`a8c131d`](https://github.com/podosoft-dev/podokit/commit/a8c131dfebb5fe9c93655cb03dce713aa0cee244) Thanks [@korone00](https://github.com/korone00)! - Scope event streams and stream stored objects. SSE events carry a topic and an optional audience, each stream receives only the topics and audiences it may read, queues are bounded with a `resync` event, `POST /events` is admin-only, job progress reaches only its owner, and web apps get a shared `EventSource` helper in `$lib/events`. `RequestIdentity` gains `roles()` and `activeOrganizationId()`. The admin sessions and users pages page on the server (`GET`/`DELETE /admin/sessions`), and admin reads use the general rate budget. `ObjectStore.get` returns metadata with a lazily opened stream, `stat()` and paged `list()` are new, `objectResponse()` serves objects with validators and 304, and favicons and profile images stream from storage with versioned favicons cached as immutable. The 2FA QR code loads on demand and idle-timeout tracking writes storage at most every five seconds.

### Patch Changes

- Updated dependencies [[`a8c131d`](https://github.com/podosoft-dev/podokit/commit/a8c131dfebb5fe9c93655cb03dce713aa0cee244)]:
  - @podosoft/podokit-runtime@0.3.0

## 1.1.6

### Patch Changes

- [#210](https://github.com/podosoft-dev/podokit/pull/210) [`72c8616`](https://github.com/podosoft-dev/podokit/commit/72c8616004f857bdab50878ec759b0e8f0086c02) Thanks [@korone00](https://github.com/korone00)! - Skip Better Auth's startup schema check in the generated migration runner, so `migrate:all` no longer logs `Database schema mismatch` for the schema it is about to migrate. API servers keep validating the schema at startup.

## 1.1.5

### Patch Changes

- [#208](https://github.com/podosoft-dev/podokit/pull/208) [`8b23bbb`](https://github.com/podosoft-dev/podokit/commit/8b23bbbcd774965953174ea9b12b951ad24066e2) Thanks [@korone00](https://github.com/korone00)! - Download the presigned object in the generated storage API test only when the test runner has `S3_ENDPOINT`, so the test passes against a containerized `podo dev` stack whose URLs are signed for an in-network host.

## 1.1.4

### Patch Changes

- [#205](https://github.com/podosoft-dev/podokit/pull/205) [`4749967`](https://github.com/podosoft-dev/podokit/commit/474996791e7352d2574eb3e679b2b937ae25e403) Thanks [@korone00](https://github.com/korone00)! - Run the generated API type check with `bunx --bun tsc`, so an older Node on `PATH`, such as the one on some self-hosted CI runners, no longer runs TypeScript and fails `bun run lint`.

## 1.1.3

### Patch Changes

- [#198](https://github.com/podosoft-dev/podokit/pull/198) [`d7b3905`](https://github.com/podosoft-dev/podokit/commit/d7b39055dc66af0e070630a4533aa0588aaed37e) Thanks [@dependabot](https://github.com/apps/dependabot)! - Require Better Auth 1.7.7 and matching API key, passkey, and OAuth provider integrations in the API client and generated authentication module. Document coordinated upgrades and reissuing pending Magic Links after the security update.

  Clean up obsolete account issuer constraints before applying the current PostgreSQL or SQLite authentication schema. Preserve account data, reject identity collisions, and support repeated migrations.

- [#203](https://github.com/podosoft-dev/podokit/pull/203) [`72eca65`](https://github.com/podosoft-dev/podokit/commit/72eca657c8c0a10eb5667f929e571112d1295da7) Thanks [@korone00](https://github.com/korone00)! - Clarify project creation defaults and document SQLite, memory cache/events, local files, and local jobs for simple single-process applications. Align generated README and agent guidance with provider selection, host development, and current module migration workflows.

- [#203](https://github.com/podosoft-dev/podokit/pull/203) [`72eca65`](https://github.com/podosoft-dev/podokit/commit/72eca657c8c0a10eb5667f929e571112d1295da7) Thanks [@korone00](https://github.com/korone00)! - Fix the Todo template's SQLite migration and normalize UUIDs, booleans, and timestamps so SQLite and PostgreSQL return the same API types. Ship persistence and HTTP/browser CRUD regression tests with generated Todo projects.

## 1.1.2

### Patch Changes

- [#200](https://github.com/podosoft-dev/podokit/pull/200) [`9f46fb3`](https://github.com/podosoft-dev/podokit/commit/9f46fb3dbad3cf369f88191844b82c2df35894c4) Thanks [@korone00](https://github.com/korone00)! - Require configured S3 smoke tests to succeed and verify presigned downloads against the real storage service. Document complete data and IAM backups when upgrading existing MinIO installations to Silo.
  
  Disable automatic dependency rollback when a Kubernetes-managed storage image changes, cannot be confirmed, or differs from Helm's recorded image, while preserving automatic application rollback. Require complete data and IAM recovery before restarting the previous storage image.
  
  Pin development Silo and mc images by release and digest so local storage migration rehearsals use the same binaries.

## 1.1.1

### Patch Changes

- [#196](https://github.com/podosoft-dev/podokit/pull/196) [`50fe0a9`](https://github.com/podosoft-dev/podokit/commit/50fe0a9711c6ec3f7694ad0ec779b6e209eb9f92) Thanks [@dependabot](https://github.com/apps/dependabot)! - Use available Silo images for generated development and deployment storage, and update the MCP SDK to 1.30.1.

## 1.1.0

### Minor Changes

- [#187](https://github.com/podosoft-dev/podokit/pull/187) [`77abca6`](https://github.com/podosoft-dev/podokit/commit/77abca69c99ff284a600e139e9664590483e3e75) Thanks [@korone00](https://github.com/korone00)! - Add provider-neutral database, cache, object storage, event, and job contracts with selectable distributed and local implementations.
  
  Add dry-run-first provider inspection and switching for existing generated projects, SQLite project generation, provider-aware deployment profiles, and local single-process modules for desktop applications.
  
  Generalize the auth configuration store around a database-neutral repository contract.

### Patch Changes

- [#183](https://github.com/podosoft-dev/podokit/pull/183) [`669c020`](https://github.com/podosoft-dev/podokit/commit/669c020aa84a2a6d8752b40cd5ccf4a461af5dfe) Thanks [@korone00](https://github.com/korone00)! - Keep read-only session checks out of the stricter authentication mutation request budget.

- [#180](https://github.com/podosoft-dev/podokit/pull/180) [`47e2f83`](https://github.com/podosoft-dev/podokit/commit/47e2f830bb327f3b2bb1197c93a5683ecc9df6ba) Thanks [@korone00](https://github.com/korone00)! - Migrate populated Better Auth 1.6 account identities safely before applying the 1.7 schema.

- [#182](https://github.com/podosoft-dev/podokit/pull/182) [`32ee57f`](https://github.com/podosoft-dev/podokit/commit/32ee57f365f32a428f8cedcbd9b101ac11fc06ff) Thanks [@korone00](https://github.com/korone00)! - Route exact WebSocket paths to the API in Docker Compose deployments without exposing a second host port, and trust forwarded headers only from explicitly configured proxy CIDRs.
- Updated dependencies [[`77abca6`](https://github.com/podosoft-dev/podokit/commit/77abca69c99ff284a600e139e9664590483e3e75)]:
  - @podosoft/podokit-runtime@0.2.0

## 1.0.2

### Patch Changes

- [#179](https://github.com/podosoft-dev/podokit/pull/179) [`12b51dd`](https://github.com/podosoft-dev/podokit/commit/12b51dd6978db53d89e1983309afc369f90618e9) Thanks [@korone00](https://github.com/korone00)! - Keep the faithful generated-app suite below its shared rate-limit ceiling, surface failed feature-toggle writes directly, and send same-origin headers for browser-context blog deletion checks.

- [#177](https://github.com/podosoft-dev/podokit/pull/177) [`5138312`](https://github.com/podosoft-dev/podokit/commit/51383127bf262396b57e0a39fe12fd17fead09fd) Thanks [@korone00](https://github.com/korone00)! - Run generated Kubernetes and Docker Compose workers and migrations with Bun, and keep two-factor setup compatible with Better Auth response variants.

## 1.0.1

### Patch Changes

- [#175](https://github.com/podosoft-dev/podokit/pull/175) [`610e542`](https://github.com/podosoft-dev/podokit/commit/610e542ba32226fc01dc4d2c132b78167da7e5c5) Thanks [@korone00](https://github.com/korone00)! - Bind blog tags as native JSON arrays with Bun SQL, isolate browser authors from
  rate-limit state across repeated test runs, and let SvelteKit page metadata own
  the document title without a conflicting static template title. Use one Elysia
  route parameter name for blog post identifiers and slugs so the router can
  compile every blog endpoint together.

- [#175](https://github.com/podosoft-dev/podokit/pull/175) [`610e542`](https://github.com/podosoft-dev/podokit/commit/610e542ba32226fc01dc4d2c132b78167da7e5c5) Thanks [@korone00](https://github.com/korone00)! - Use each container's configured `PORT` for generated API and web health checks.

- [#175](https://github.com/podosoft-dev/podokit/pull/175) [`610e542`](https://github.com/podosoft-dev/podokit/commit/610e542ba32226fc01dc4d2c132b78167da7e5c5) Thanks [@korone00](https://github.com/korone00)! - Reject Elysia routes that use different parameter names at the same structural
  router position during generated API contract verification, and document the
  invariant in generated endpoint guidance.

- [#175](https://github.com/podosoft-dev/podokit/pull/175) [`610e542`](https://github.com/podosoft-dev/podokit/commit/610e542ba32226fc01dc4d2c132b78167da7e5c5) Thanks [@korone00](https://github.com/korone00)! - Run the generated development SMS sink and application maintenance scripts on
  the pinned Bun toolchain so every generated application-side JavaScript process
  follows the Bun-only v1 runtime contract.

- [#175](https://github.com/podosoft-dev/podokit/pull/175) [`610e542`](https://github.com/podosoft-dev/podokit/commit/610e542ba32226fc01dc4d2c132b78167da7e5c5) Thanks [@korone00](https://github.com/korone00)! - Keep generated authentication flows aligned with Better Auth 1.7 by narrowing
  two-factor setup responses and running schema migrations through the version
  installed by the application. Pin anonymous browser tests to English so a
  custom site locale does not invalidate the generated accessibility locators.
  Follow OIDC authorization redirects explicitly in browser tests and keep
  module-agnostic smoke coverage compatible with application-owned home pages.

## 1.0.0

### Major Changes

- [#171](https://github.com/podosoft-dev/podokit/pull/171) [`46352bc`](https://github.com/podosoft-dev/podokit/commit/46352bc6187dcc1aabff86789c214ccf7efad36a) Thanks [@korone00](https://github.com/korone00)! - Generate Bun 1.4.0 applications with an Elysia request path, native Bun SQL,
  Redis, and S3 integrations, Alpine production images, merged OpenAPI documents,
  and executable endpoint-contract verification.

  Replace the former runtime-selection and conversion surface with a Bun-only v1
  project model. Existing PodoKit 0.x applications must remain on the final 0.x
  CLI instead of being converted in place.

  Port the Blog and Analytics external modules to the Elysia service registry and
  Bun SQL while preserving their documented HTTP behavior and UI features.

### Minor Changes

- [#173](https://github.com/podosoft-dev/podokit/pull/173) [`d4a7ca4`](https://github.com/podosoft-dev/podokit/commit/d4a7ca4e432a6b410e98b1eeb8456fe6d3ef13ac) Thanks [@korone00](https://github.com/korone00)! - Use the official SvelteKit Bun adapter and route explicitly allowed WebSocket paths through development and Kubernetes gateways.

### Patch Changes

- [#169](https://github.com/podosoft-dev/podokit/pull/169) [`eb0c707`](https://github.com/podosoft-dev/podokit/commit/eb0c707d484c6458e8c8c99866e9973875649654) Thanks [@dependabot](https://github.com/apps/dependabot)! - Align generated authentication dependencies with Better Auth 1.7.1 and use local account row IDs when unlinking providers.

- [#174](https://github.com/podosoft-dev/podokit/pull/174) [`d010fd9`](https://github.com/podosoft-dev/podokit/commit/d010fd9466617d4219a0573eefa90031066df3fb) Thanks [@korone00](https://github.com/korone00)! - Complete SvelteKit 3 package-import migration and synchronize self-contained web builds safely.

- [#163](https://github.com/podosoft-dev/podokit/pull/163) [`c225b20`](https://github.com/podosoft-dev/podokit/commit/c225b206508e486f37dbbc12fb67195bd978c02e) Thanks [@korone00](https://github.com/korone00)! - Update generated fullstack and Todo dependency floors and narrowly override vulnerable transitive packages so fresh npm installs pass the security audit.

- [#165](https://github.com/podosoft-dev/podokit/pull/165) [`1070954`](https://github.com/podosoft-dev/podokit/commit/10709541c3f8b257db97fbcd6c4153abfd659a58) Thanks [@korone00](https://github.com/korone00)! - Keep generated authentication tests isolated and align the impersonation, passkey, OIDC, and audit-log flows with their production routes and defaults.

- [#172](https://github.com/podosoft-dev/podokit/pull/172) [`b5c6b55`](https://github.com/podosoft-dev/podokit/commit/b5c6b55365de5d4ab2b187cb8362908bc4462257) Thanks [@korone00](https://github.com/korone00)! - Keep generated starter landing pages focused on product actions instead of framework implementation details.

## 0.17.4

### Patch Changes

- [#152](https://github.com/podosoft-dev/podokit/pull/152) [`9892142`](https://github.com/podosoft-dev/podokit/commit/98921425c4af85150b6a6481ab702a6a2d3e0ef3) Thanks [@korone00](https://github.com/korone00)! - Return regular users to the shared account page after mandatory two-factor enrollment and keep the account route behind the enrollment gate.

## 0.17.3

### Patch Changes

- [#150](https://github.com/podosoft-dev/podokit/pull/150) [`5c85c4a`](https://github.com/podosoft-dev/podokit/commit/5c85c4a1bdcd3f1a12cd913c53412a9b48e18480) Thanks [@korone00](https://github.com/korone00)! - Add a detached `podo dev up` lifecycle command, restore shared gateway routing when refreshing generated development apps, remove stale routes when a project's local hostname changes, and seed newly introduced owned files without overwriting existing application paths.

## 0.17.2

### Patch Changes

- [#148](https://github.com/podosoft-dev/podokit/pull/148) [`1be595c`](https://github.com/podosoft-dev/podokit/commit/1be595c6af3d7e9ab13e8a38ccea1b95441e8f96) Thanks [@korone00](https://github.com/korone00)! - Explain when an account session is too old to list other sessions and offer a direct
  sign-in action instead of showing the upstream error in a toast.

## 0.17.1

### Patch Changes

- [#145](https://github.com/podosoft-dev/podokit/pull/145) [`38a7226`](https://github.com/podosoft-dev/podokit/commit/38a72268da361f19125179e1b3b02fa76bfebc51) Thanks [@korone00](https://github.com/korone00)! - Confirm a new password when resetting it or changing it from the account page.

  Both forms took the new password once. A reset spends a single-use token, so a typo
  costs another trip through the mailbox; a change from the account page simply
  succeeds, and the mistake surfaces at the next sign-in with a password the person
  cannot reproduce.

- [#146](https://github.com/podosoft-dev/podokit/pull/146) [`dbb3dab`](https://github.com/podosoft-dev/podokit/commit/dbb3dabe82ab45de80aee7554028b8d2e5c14694) Thanks [@korone00](https://github.com/korone00)! - Stop the e2e suite from depending on a seeded account's password, and fix the
  change-password spec that could never pass.

  `tests/helpers/accounts.ts` hardcoded the seed password, so the suite could only
  sign in on a stack it had created itself. Against an install bootstrapped with
  `admin:bootstrap`, `admin@example.com` is a real account with a password somebody
  uses — and the only way to make the run green was to reset that account to match
  the constant, which takes their login with it. The passwords now read
  `E2E_ADMIN_PASSWORD` / `E2E_USER_PASSWORD` and fall back to the seed value, so an
  existing account is told to the suite instead of altered. Without the override the
  run fails with `INVALID_EMAIL_OR_PASSWORD` — a refusal rather than a silent
  overwrite. The two-factor and account specs that signed in as the shared accounts
  now use the same constants.

  The spec asserting that a mistyped password confirmation is refused clicked a
  button named `Update`; the button is `Update password`, so the test timed out
  before reaching its assertion and had never passed. It now clicks the real button
  and first asserts the error is absent, so a form that showed it unconditionally
  would still fail.

- [#143](https://github.com/podosoft-dev/podokit/pull/143) [`62fe5da`](https://github.com/podosoft-dev/podokit/commit/62fe5dac532c6a44552922407fb3dd56bd4dd0dc) Thanks [@korone00](https://github.com/korone00)! - Confirm the password when signing up.

  Sign-up took the password once, while every form where an administrator sets someone
  else's asks twice. It is the worst place for the omission: a mistyped sign-up costs
  the account, because the address is not verified yet and the reset link that would
  rescue it goes to an inbox the person cannot open.

## 0.17.0

### Minor Changes

- [#141](https://github.com/podosoft-dev/podokit/pull/141) [`ecdd80a`](https://github.com/podosoft-dev/podokit/commit/ecdd80a4bd3bb63c18374a49cb5e0327c455ec4f) Thanks [@korone00](https://github.com/korone00)! - Add `podo deploy sync` and a release workflow for generated projects.

  `podo deploy sync` copies a project's build output into the containers a Compose
  deployment is already running and restarts them, so iterating against a deployment
  does not need a full image round trip. It is deliberately not a release: the image
  tag is unchanged, a marker records the drift, `podo deploy status` reports it as
  `syncDrift`, and the next apply discards it. It refuses when runtime dependencies
  have changed, when a release holds the lock, or when a restarted container does not
  become healthy, and it never runs migrations. A profile can name build outputs to
  leave alone with `sync.exclude`.

  Generated projects now ship `.github/workflows/release.yml`, which builds and pushes
  both images on a `vX.Y.Z` tag. Its runner is a variable rather than a constant,
  because GitHub-hosted minutes are free only for public repositories and image builds
  are the most expensive job most projects run.

- [#139](https://github.com/podosoft-dev/podokit/pull/139) [`6561d7d`](https://github.com/podosoft-dev/podokit/commit/6561d7d561d78f7eb7b908694669b61870e97770) Thanks [@korone00](https://github.com/korone00)! - Add a `docker-compose` deployment driver alongside `kubernetes-helm`, and fix the
  production images.

  `podo deploy` now operates a Compose project on one Docker host — local or over
  `ssh://` — with the same contract the Kubernetes driver has: a fingerprinted target,
  image tags resolved to digests, a confirmation hash that apply must echo back, a
  release-scoped lock, an exact-image migration before rollout, public verification, and
  rollback. A profile declares its own `driver`, so every command after `init` reads it
  from the profile, and the MCP tools follow it too.

  The production Dockerfiles were only buildable for the template's own three
  workspaces. They now collect every workspace manifest, carry the whole install output
  into the build, compile local `packages/*` before the app that imports them, install
  the npm major that wrote the lockfile, prune the runtime tree, declare a healthcheck,
  and keep `.env` out of the build context.

  Generated projects now ship an upgrade-capable web entry point. A SvelteKit route
  cannot answer a WebSocket upgrade, so an API gateway was unreachable once deployed;
  `apps/web/server.js` keeps adapter-node in charge and relays the exact paths named in
  `WS_PROXY_PATHS`, matched whole. Nothing is forwarded by default.

  The example `infra/k3s` manifests no longer contradict the deployment tooling: they
  carry probes, an `ingressClassName`, a TLS block, placeholder tags instead of
  `latest`, and a README saying `podo deploy` renders the manifests it actually applies.

### Patch Changes

- [#142](https://github.com/podosoft-dev/podokit/pull/142) [`aa06b1d`](https://github.com/podosoft-dev/podokit/commit/aa06b1dd5b6ecfde8371041c5253ff14328e211a) Thanks [@korone00](https://github.com/korone00)! - Show the real device on a session, and build the dev image for a project with
  shared packages.

  The server proxy did not forward `user-agent`, and fetch supplies its own default
  when the header is absent — so every session recorded "node" and the account page
  showed that as the device for all of them. The proxy now forwards it, and the
  sessions tables render a readable name ("Chrome · macOS") with the exact string on
  hover, falling back to the raw value for anything that is not a browser.

  `Dockerfile.dev` also listed workspace manifests by hand and never built the
  workspace packages. Both are invisible to a project with only the template's own
  workspaces and fatal to one that adds `packages/*`: npm looked for local packages on
  the public registry, and the API died on MODULE_NOT_FOUND for a package whose
  symlink resolved to a `dist` that was never compiled.

## 0.16.4

### Patch Changes

- [#137](https://github.com/podosoft-dev/podokit/pull/137) [`d6033e5`](https://github.com/podosoft-dev/podokit/commit/d6033e513b1b90224c0a06b4deb3767d62ecd4c0) Thanks [@korone00](https://github.com/korone00)! - Allow deployment profiles to override the exact API migration command while preserving the existing default.

- [#137](https://github.com/podosoft-dev/podokit/pull/137) [`d6033e5`](https://github.com/podosoft-dev/podokit/commit/d6033e513b1b90224c0a06b4deb3767d62ecd4c0) Thanks [@korone00](https://github.com/korone00)! - Keep generated SvelteKit proxies available when the trusted proxy address chain is absent or shorter than configured.

## 0.16.3

### Patch Changes

- [#135](https://github.com/podosoft-dev/podokit/pull/135) [`092d932`](https://github.com/podosoft-dev/podokit/commit/092d932de128192809772df002c2456891d208a9) Thanks [@korone00](https://github.com/korone00)! - Label object storage initialization Jobs so deployment lifecycle selectors find them.

## 0.16.2

### Patch Changes

- [#133](https://github.com/podosoft-dev/podokit/pull/133) [`e68d849`](https://github.com/podosoft-dev/podokit/commit/e68d849eab52ee41a3aa96f3b84b0334a28ab041) Thanks [@korone00](https://github.com/korone00)! - Nest explicit storage class names correctly in rendered persistent volume claims.

## 0.16.1

### Patch Changes

- [#131](https://github.com/podosoft-dev/podokit/pull/131) [`07c7250`](https://github.com/podosoft-dev/podokit/commit/07c725084585facc176f12d97a65b8745e5615d2) Thanks [@korone00](https://github.com/korone00)! - Write Kubernetes Lease timestamps with the six fractional digits required by MicroTime.

- [#131](https://github.com/podosoft-dev/podokit/pull/131) [`23c2d79`](https://github.com/podosoft-dev/podokit/commit/23c2d7942edd74c63003f6faf3efd9e71d258449) Thanks [@korone00](https://github.com/korone00)! - Apply module requirements introduced by a newer PodoKit version during `podo update` so existing projects receive complete dependency graphs instead of partial generated imports.

## 0.16.0

### Minor Changes

- [#129](https://github.com/podosoft-dev/podokit/pull/129) [`7698c8a`](https://github.com/podosoft-dev/podokit/commit/7698c8a803908b9cf7efd093e0d8bf78e0d6db9a) Thanks [@korone00](https://github.com/korone00)! - Add an external analytics module with provider-neutral events, GA4 collection
  and aggregate reports, advanced consent mode, encrypted administrator
  configuration, and a managed site-runtime injection point.

  Publish and install the external analytics package in the faithful generated-app
  Outer path so its package contents, injections, migrations, and shipped tests
  participate in release-gate validation.

  Make `podo remove` fully reverse multi-line module injections and discard
  module-owned globs when no preserved edited file or other module still needs
  them. Treat the project manifest as authoritative when resolving already
  installed dependencies so adding an external module cannot re-overlay a
  customized required module.

- [#129](https://github.com/podosoft-dev/podokit/pull/129) [`7698c8a`](https://github.com/podosoft-dev/podokit/commit/7698c8a803908b9cf7efd093e0d8bf78e0d6db9a) Thanks [@korone00](https://github.com/korone00)! - Add guarded Kubernetes deployment profiles, deterministic Helm render and plan
  operations, exact-image migrations, confirmation-hash apply and rollback,
  deployment status and verification, plus read-only MCP inspection tools and a
  generated deployment skill.

  Add authenticated Redis connection settings, multi-replica Redis SSE delivery,
  extensible readiness checks, shared distributed rate limiting with a single
  managed application identity extension point, explicit adoption of existing
  Redis and rate-limit implementations, and production k3s ingress and readiness
  corrections. Development commands now activate Compose profiles required by the
  installed module graph.

### Patch Changes

- Updated dependencies [[`7698c8a`](https://github.com/podosoft-dev/podokit/commit/7698c8a803908b9cf7efd093e0d8bf78e0d6db9a)]:
  - @podosoft/podokit-template-engine@0.4.2

## 0.15.0

### Minor Changes

- [#127](https://github.com/podosoft-dev/podokit/pull/127) [`f174097`](https://github.com/podosoft-dev/podokit/commit/f1740974d833bdf00ef6e9dba37daf834c77fd8f) Thanks [@korone00](https://github.com/korone00)! - Add application-owned Playwright projects, reusable product-shell identity menus, and responsive DataTable column helpers. Keep generated admin tests repeatable by cleaning up disposable users and pinning their UI locale, and stop `podo update` from restoring explicitly ejected files after applications relocate them.

## 0.14.0

### Minor Changes

- [#121](https://github.com/podosoft-dev/podokit/pull/121) [`820a4c5`](https://github.com/podosoft-dev/podokit/commit/820a4c5eb7c5553f749591e4e25dfc9318d77c3f) Thanks [@korone00](https://github.com/korone00)! - Show the shared language and light/dark theme controls beside the signed-in account menu on generated landing pages.

- [#123](https://github.com/podosoft-dev/podokit/pull/123) [`4525328`](https://github.com/podosoft-dev/podokit/commit/4525328016cb3af38f5520ea41e170f6fe59cef6) Thanks [@korone00](https://github.com/korone00)! - Separate the generated admin-only console into the `(admin)` route group, keep `(app)` available for protected product pages, and migrate existing admin routes safely during `podo update`.

- [#119](https://github.com/podosoft-dev/podokit/pull/119) [`cd7e13b`](https://github.com/podosoft-dev/podokit/commit/cd7e13b7a93b4fea7588ffed87c82ac5be8073ee) Thanks [@korone00](https://github.com/korone00)! - Add self-service profile-image upload, replacement, removal, shared validation limits, multipart API client support, and a reusable signed-in account menu for generated landing pages.

### Patch Changes

- [#121](https://github.com/podosoft-dev/podokit/pull/121) [`820a4c5`](https://github.com/podosoft-dev/podokit/commit/820a4c5eb7c5553f749591e4e25dfc9318d77c3f) Thanks [@korone00](https://github.com/korone00)! - Use the file-list binding without a conflicting value binding and forward change events explicitly from the generated shared input component so file upload controls work reliably.

## 0.13.0

### Minor Changes

- [#114](https://github.com/podosoft-dev/podokit/pull/114) [`b05637f`](https://github.com/podosoft-dev/podokit/commit/b05637f68518080cf88bca87a79a8b9aae1aee25) Thanks [@korone00](https://github.com/korone00)! - Add a live automatic-logout policy with validated idle durations, sliding Better Auth session expiration, existing-session updates, cross-tab browser inactivity handling, and localized admin controls.

### Patch Changes

- [#112](https://github.com/podosoft-dev/podokit/pull/112) [`2940f05`](https://github.com/podosoft-dev/podokit/commit/2940f0590e6d64b16b2dcdd49413789f5acb2143) Thanks [@korone00](https://github.com/korone00)! - Align the generated admin dashboard navigation test with the public account route
  and keep `@smoke` focused on critical cross-module paths while the default suite
  retains full coverage.

## 0.12.4

### Patch Changes

- [#110](https://github.com/podosoft-dev/podokit/pull/110) [`2d0d99b`](https://github.com/podosoft-dev/podokit/commit/2d0d99b0717c2cbd9038b91b93c86fe98783e653) Thanks [@korone00](https://github.com/korone00)! - Keep admin dashboard route server loaders update-managed while preserving application-owned route presentation and root layouts.

## 0.12.3

### Patch Changes

- [#108](https://github.com/podosoft-dev/podokit/pull/108) [`752ae13`](https://github.com/podosoft-dev/podokit/commit/752ae13e6d379dbc0db03faae694d8119f92c1f9) Thanks [@korone00](https://github.com/korone00)! - Return 503 for protected pages when session or site policy checks cannot reach the backend, while preserving session cookies and public-page fallbacks.

## 0.12.2

### Patch Changes

- [#103](https://github.com/podosoft-dev/podokit/pull/103) [`ad6d0dc`](https://github.com/podosoft-dev/podokit/commit/ad6d0dc1fe216397f26a95b522706c1ed4083e2f) Thanks [@korone00](https://github.com/korone00)! - Reconstruct three-way merge bases with the external module versions recorded in the project manifest.

## 0.12.1

### Patch Changes

- [#101](https://github.com/podosoft-dev/podokit/pull/101) [`5fb7791`](https://github.com/podosoft-dev/podokit/commit/5fb7791b3af8a6f4a2bc90e77e88c089841500e9) Thanks [@korone00](https://github.com/korone00)! - Report an actionable error when a three-way update uses previous templates after an external module was already upgraded.

## 0.12.0

### Minor Changes

- [#99](https://github.com/podosoft-dev/podokit/pull/99) [`b048480`](https://github.com/podosoft-dev/podokit/commit/b048480b8a35f1e26ad8c1c354822e1ea3477d22) Thanks [@korone00](https://github.com/korone00)! - Add split JSON locale catalogs, runtime fallback composition, locale management commands, and a generated locale workflow skill.

- [#99](https://github.com/podosoft-dev/podokit/pull/99) [`b048480`](https://github.com/podosoft-dev/podokit/commit/b048480b8a35f1e26ad8c1c354822e1ea3477d22) Thanks [@korone00](https://github.com/korone00)! - Add `podo dev` with a socket-free shared loopback gateway, project-owned portless hostnames, Compose lifecycle helpers, and browser-origin HMR that also works through provider-neutral HTTPS tunnels.

### Patch Changes

- [#99](https://github.com/podosoft-dev/podokit/pull/99) [`b048480`](https://github.com/podosoft-dev/podokit/commit/b048480b8a35f1e26ad8c1c354822e1ea3477d22) Thanks [@korone00](https://github.com/korone00)! - Preserve a selected locale during SSR even when an application owns a non-English
  default or additional document attributes in `app.html`.

- [#99](https://github.com/podosoft-dev/podokit/pull/99) [`b048480`](https://github.com/podosoft-dev/podokit/commit/b048480b8a35f1e26ad8c1c354822e1ea3477d22) Thanks [@korone00](https://github.com/korone00)! - Enforce closed public registration for every new-user flow, including social OAuth callbacks, return a stable policy error code, preserve safe authentication return paths, persist exact OAuth callbacks for stable HTTPS development origins, and allow callback-only repair without replacing stored provider credentials.

- [#99](https://github.com/podosoft-dev/podokit/pull/99) [`b048480`](https://github.com/podosoft-dev/podokit/commit/b048480b8a35f1e26ad8c1c354822e1ea3477d22) Thanks [@korone00](https://github.com/korone00)! - Stop services from every Compose profile when running `podo dev down`.

- [#99](https://github.com/podosoft-dev/podokit/pull/99) [`b048480`](https://github.com/podosoft-dev/podokit/commit/b048480b8a35f1e26ad8c1c354822e1ea3477d22) Thanks [@korone00](https://github.com/korone00)! - Show the application default in General Settings when the stored site locale is empty.

- [#99](https://github.com/podosoft-dev/podokit/pull/99) [`b048480`](https://github.com/podosoft-dev/podokit/commit/b048480b8a35f1e26ad8c1c354822e1ea3477d22) Thanks [@korone00](https://github.com/korone00)! - Promote newly declared default-owned paths during update so project-specific
  configuration remains untouched.

## 0.11.2

### Patch Changes

- [#95](https://github.com/podosoft-dev/podokit/pull/95) [`05fc8a8`](https://github.com/podosoft-dev/podokit/commit/05fc8a87b4f6ca3c4247eeaebaf42e2d206d91d5) Thanks [@korone00](https://github.com/korone00)! - Add an idempotent, secret-safe initial administrator bootstrap command, keep its generated authentication skill update-managed, and include generated operator scripts in API runtime images.

## 0.11.1

### Patch Changes

- [#92](https://github.com/podosoft-dev/podokit/pull/92) [`63a1a4e`](https://github.com/podosoft-dev/podokit/commit/63a1a4ed14828d951d8709f0843c284ab8fd160f) Thanks [@korone00](https://github.com/korone00)! - Update generated app and module dependency ranges to install the package versions required by the sign-up approval APIs.

## 0.11.0

### Minor Changes

- [#90](https://github.com/podosoft-dev/podokit/pull/90) [`b6267eb`](https://github.com/podosoft-dev/podokit/commit/b6267ebc568c01fdf35452c17a00a8d068cdcb36) Thanks [@korone00](https://github.com/korone00)! - Add provider-independent sign-up approval, admin approval controls, social-login buttons, and redacted OAuth/SMTP configuration automation.

## 0.10.2

### Patch Changes

- [#87](https://github.com/podosoft-dev/podokit/pull/87) [`829ef6c`](https://github.com/podosoft-dev/podokit/commit/829ef6c3bfe6d5408c0a20028672f05c95cc7886) Thanks [@korone00](https://github.com/korone00)! - Keep generated liveness and readiness endpoints outside the global rate-limit quota.

## 0.10.1

### Patch Changes

- [#85](https://github.com/podosoft-dev/podokit/pull/85) [`1b951ca`](https://github.com/podosoft-dev/podokit/commit/1b951ca439c7bd4b8ca5d467d79298dad91c3420) Thanks [@korone00](https://github.com/korone00)! - Add a compiled production migration command that applies Better Auth and TypeORM schemas for container deployment jobs.

- [#85](https://github.com/podosoft-dev/podokit/pull/85) [`1b951ca`](https://github.com/podosoft-dev/podokit/commit/1b951ca439c7bd4b8ca5d467d79298dad91c3420) Thanks [@korone00](https://github.com/korone00)! - Stabilize generated admin smoke tests across hydrated tabs, settings saves, and application-owned landing pages.

- [#85](https://github.com/podosoft-dev/podokit/pull/85) [`1b951ca`](https://github.com/podosoft-dev/podokit/commit/1b951ca439c7bd4b8ca5d467d79298dad91c3420) Thanks [@korone00](https://github.com/korone00)! - Build generated API and web production images reproducibly from the root npm workspace lockfile and align their runtime with the authentication stack's Node.js requirement.

- [#85](https://github.com/podosoft-dev/podokit/pull/85) [`1b951ca`](https://github.com/podosoft-dev/podokit/commit/1b951ca439c7bd4b8ca5d467d79298dad91c3420) Thanks [@korone00](https://github.com/korone00)! - Return HTTP 503 from generated API readiness probes when PostgreSQL is unavailable.

- [#85](https://github.com/podosoft-dev/podokit/pull/85) [`1b951ca`](https://github.com/podosoft-dev/podokit/commit/1b951ca439c7bd4b8ca5d467d79298dad91c3420) Thanks [@korone00](https://github.com/korone00)! - Track rate limits by the resolved visitor address, configure the trusted Traefik hop, avoid redundant runtime lookups, and protect critical SSR settings reads with a separate ceiling.

## 0.10.0

### Minor Changes

- [#83](https://github.com/podosoft-dev/podokit/pull/83) [`c9d9bdf`](https://github.com/podosoft-dev/podokit/commit/c9d9bdf19c8b6ab77fcef8e619c0ccb79458ef8d) Thanks [@korone00](https://github.com/korone00)! - Add a signed-in user account page and reusable avatar menu while retaining the existing admin account route.

- [#83](https://github.com/podosoft-dev/podokit/pull/83) [`c9d9bdf`](https://github.com/podosoft-dev/podokit/commit/c9d9bdf19c8b6ab77fcef8e619c0ccb79458ef8d) Thanks [@korone00](https://github.com/korone00)! - Support versioned external package modules during `podo update`, add explicit managed-path adoption with `podo add --adopt`, preserve pre-existing application drift and unrelated files when refreshing the generated lock, and route global module behavior through a managed site-runtime slot without replacing app-owned pages.

### Patch Changes

- [#83](https://github.com/podosoft-dev/podokit/pull/83) [`c9d9bdf`](https://github.com/podosoft-dev/podokit/commit/c9d9bdf19c8b6ab77fcef8e619c0ccb79458ef8d) Thanks [@korone00](https://github.com/korone00)! - Preserve user edits across repeated updates by keeping the assembled template as the managed lock baseline after a 3-way merge.

- [#83](https://github.com/podosoft-dev/podokit/pull/83) [`c9d9bdf`](https://github.com/podosoft-dev/podokit/commit/c9d9bdf19c8b6ab77fcef8e619c0ccb79458ef8d) Thanks [@korone00](https://github.com/korone00)! - Simplify the generated admin Appearance screen with focused preset choices, practical quick settings, and a larger theme preview while keeping every existing theme key and setting compatible.

- [#83](https://github.com/podosoft-dev/podokit/pull/83) [`c9d9bdf`](https://github.com/podosoft-dev/podokit/commit/c9d9bdf19c8b6ab77fcef8e619c0ccb79458ef8d) Thanks [@korone00](https://github.com/korone00)! - Prevent search engines from indexing generated admin, account, authentication, maintenance, and API routes.

- [#83](https://github.com/podosoft-dev/podokit/pull/83) [`c9d9bdf`](https://github.com/podosoft-dev/podokit/commit/c9d9bdf19c8b6ab77fcef8e619c0ccb79458ef8d) Thanks [@korone00](https://github.com/korone00)! - Ignore Playwright authentication, report, and test-result artifacts from both configured and root execution paths, plus local Lighthouse reports.

- [#83](https://github.com/podosoft-dev/podokit/pull/83) [`c9d9bdf`](https://github.com/podosoft-dev/podokit/commit/c9d9bdf19c8b6ab77fcef8e619c0ccb79458ef8d) Thanks [@korone00](https://github.com/korone00)! - Wait for Svelte login hydration in the generated two-factor Playwright tests.

- [#83](https://github.com/podosoft-dev/podokit/pull/83) [`c9d9bdf`](https://github.com/podosoft-dev/podokit/commit/c9d9bdf19c8b6ab77fcef8e619c0ccb79458ef8d) Thanks [@korone00](https://github.com/korone00)! - Enable Traefik response compression in generated container and k3s ingress configurations.
