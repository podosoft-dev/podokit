# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
