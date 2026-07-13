# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Theme / Appearance settings (admin-dashboard).** A dedicated **Appearance**
  tab in admin Settings replaces the single "Brand color" field with a full theme:
  pick a built-in **preset** (Default + shadcn base colors Zinc/Slate/Stone/Gray/
  Neutral + accents Blue/Green/Violet/Rose), an **accent color**, a **corner
  radius**, and (Advanced) **per-token color overrides** — with a live preview that
  **toggles between light and dark**, plus a one-click **Restore defaults**. Saving applies the theme across the whole app instantly
  via a mode-scoped stylesheet (`:root:not(.dark)` / `:root.dark`), so light and dark
  are tuned independently and dark is never disturbed by a light edit. New public
  site settings keys `themePreset`, `themeRadius`, `themeOverrides` (validated to
  prevent CSS injection); reuses the existing `brandColor`. New reusable modules
  `$lib/site/themes.ts` and `$lib/site/apply-theme.ts`. i18n (en/ko) and Playwright
  (ui + api) tests included. No DB migration (uses the existing `app_setting` store).

### Fixed
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
- The `fullstack-nest-svelte` and `todo` templates now use `@podosoft/podokit-api-client` for all API access, with SvelteKit proxy routes (`/api/auth/[...all]`, `/api/[...path]`) that forward cookies and relay `Set-Cookie`. A `$lib/api.ts` (browser) and `$lib/server/api.ts` (SSR) factory ship in the templates.

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
