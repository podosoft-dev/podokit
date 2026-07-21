# Local development

How to work on PodoKit itself — templates, modules, and the packages — and
verify changes in a real generated app **without publishing to npm**.

## Why this is needed

The `fullstack-nest-svelte` and `todo` templates depend on
`@podosoft/podokit-api-client`. Until that package is published, a freshly
generated app cannot `npm install` it from the registry. For local work we
point the generated app at the **local** package instead.

## One command

```bash
# from the monorepo root
node scripts/dev-app.mjs /tmp/myapp                      # fullstack, no modules
node scripts/dev-app.mjs /tmp/myapp --add auth,admin-dashboard
node scripts/dev-app.mjs /tmp/myapp --template todo --no-build
```

`scripts/dev-app.mjs`:
1. builds the monorepo (skip with `--no-build`),
2. generates the app with the local CLI,
3. rewrites the web app's `@podosoft/podokit-api-client` dependency to
   `file:<repo>/packages/api-client` and installs it with `--install-links`
   (packed like a registry dependency instead of left as a symlink),
4. applies any `--add` modules,
5. runs `npm install --install-links`.

## Iterating on the api-client

After editing `packages/api-client`:

```bash
npm run build -w @podosoft/podokit-api-client   # in the monorepo
# then, in the generated app:
npm install --install-links                     # picks up the new local build
```

Containerized reference apps can resolve unpublished packages from a local
registry during image builds by setting `PODOKIT_NPM_REGISTRY`. The registry
must listen on an address reachable from containers (for example,
`0.0.0.0:4873`, not only `127.0.0.1`). On Docker Desktop, use the host alias
visible inside the build container, for example:

```bash
PODOKIT_NPM_REGISTRY=http://host.docker.internal:4873 podo dev watch
```

Leave the variable unset for the normal npm registry. Never put registry tokens
in this build argument; use it only with a read-open local development registry.

## Running the generated app

There are **two ways** to run a generated app while you develop. Both are supported;
pick per situation.

| | **A. Host process** (traditional) | **B. Containerized** (`compose.dev.yaml`) |
|---|---|---|
| App (web/api) | run on your host (`npm run dev`) | run in containers |
| Databases | Docker, **host ports published** (5432, 6379, 9000) | Docker, **no host ports** (internal only) |
| Reach the app | `localhost:5001` / `:5002` | a portless `http://<project>.localhost` origin |
| Multiple projects at once | ports collide — you remap by hand | one shared loopback gateway routes by hostname |
| Editors / AI agents | on the host | on the host **or inside the container** (`.devcontainer/`) |
| Best for | quick single-project work | many projects at once; dev/prod (k3s Traefik) parity |

### A. Host process (traditional)

```bash
cd /tmp/myapp
docker compose -f infra/docker/docker-compose.yml up -d                   # runtime: postgres
docker compose -f infra/docker/docker-compose.yml --profile dev up -d     # + dev tools (mailpit, sms-sink)
# if the app uses the auth module, create the auth tables:
npx @better-auth/cli migrate -y --config apps/api/src/auth/auth.ts
npm run dev                    # API + web on localhost:5001 / :5002
```

Approach **B** is documented under [Containerized development environment](#containerized-development-environment) below.

### Which services run when (compose profiles)

Services are split by what they're for, using Docker Compose profiles:

| Service | Profile | Needed for |
|---|---|---|
| `postgres` | *(none)* | **Runtime** — always started by `docker compose up`. |
| `redis` | `cache` | **Runtime, conditional** — only the cache/queue modules (redis, bullmq, rate-limit, job-progress, sse). Start with `--profile cache`. |
| `mailpit` | `dev` | **Development/testing** — local email catcher (SMTP 1025, UI/REST 8025). |
| `sms-sink` | `dev` | **Development/testing** — local SMS catcher; the app posts OTPs here via `SMS_WEBHOOK_URL`, tests read them over REST (port 8095). |
| `minio` / `minio-init` | `dev` | **Development/testing** — local S3 (object-storage-s3 module overlay); in production point `S3_*` at a real service. |

So `docker compose up` starts only what the app needs to **run**; `--profile dev up` adds the
tools you need to **develop and test** locally. In production you provide managed Postgres
(and Redis if used) and real SMTP/SMS/S3 providers — the `dev` tools never ship.

## Containerized development environment

The two commands above run the app (`npm run dev`) on your host and the databases in
Docker. If you juggle several projects at once, their databases fight over the same host
ports (5432, 6379, 9000) and the web/api ports collide too. The generated project also
ships a **fully containerized** dev environment that avoids this: everything runs in
containers, one user-level gateway owns loopback port 80, and you edit source on your host as usual.

The examples use the short `podo` executable. If the CLI is not installed globally,
replace it with `npx @podosoft/podokit`, for example
`npx @podosoft/podokit dev watch`.

```bash
cd /tmp/myapp
podo dev watch                                                   # core stack
# with modules that need extra services, enable their profiles:
podo dev watch --profile cache --profile storage --profile queue
# first run only — create the tables (in the api container):
podo dev exec api \
  npx @better-auth/cli migrate -y --config apps/api/src/auth/auth.ts
podo dev exec api npm run migration:run -w myapp-api
```

Open the URL printed by `podo dev watch`. New projects default to
**http://myapp.localhost**; browsers resolve `*.localhost` to loopback automatically.

What you get:

- **One shared entry point.** `podo dev` creates one socket-free Traefik gateway at
  `127.0.0.1:80`. Every project joins its external Docker network with a unique alias, while
  `postgres`, `redis`, `minio`, and `api` remain internal. A hostname collision fails with the
  path of the project that already owns it.
- **Project-owned hostname.** Commit `.podokit/dev.json` to select the stable local hostname and,
  optionally, document an HTTPS development origin. Ports are intentionally not part of this contract:

  ```json
  { "schemaVersion": 1, "hostname": "myapp.localhost", "publicUrl": "https://myapp-dev.example.com" }
  ```

- **Single origin.** The browser calls the web origin; SvelteKit
  proxies `/api/*` to the api container internally. The shared gateway routes the exact host to the web service
  and compresses eligible HTML, JSON, CSS, and JavaScript responses according to the browser's
  `Accept-Encoding` header. It mounts only generated file-provider routes; it never mounts the
  Docker socket.
- **Live edits.** `podo dev watch` delegates to Compose Watch. The web has
  instant Vite HMR; an **API** source change restarts the api service (~5s) — the stable
  approach for NestJS in a container (its in-process watcher doesn't reliably respawn).
- **Lifecycle helpers.** Use `podo dev ps`, `podo dev logs`, `podo dev exec`, and
  `podo dev down`. `down` automatically activates every Compose profile so it also
  removes optional services that were started by an earlier `watch` command. The last
  project removed also removes the shared gateway and network.
- **Profiles match modules** (same names as above): `cache` (redis), `storage` (minio),
  `queue` (worker). A minimal app needs none; enable the ones your app uses.
- **Editors & AI agents inside the container.** `.devcontainer/devcontainer.json` lets VS Code
  ("Reopen in Container") and Dev-Container-aware agents attach *inside* the container, where
  `node_modules`, TypeScript, and `git` all resolve. Install/upgrade packages in the container
  (`podo dev exec api npm install …`) so native binaries match Linux.

Prefer the host `npm run dev` loop for quick single-project work; reach for the containerized
loop when you run several projects at once or want dev to mirror the k3s/Traefik production
topology. These files (`compose.dev.yaml`, `Dockerfile.dev`, `.devcontainer/`, `.env.docker`,
`infra/traefik/`) are yours to edit — `podo update` never touches them. The per-project Traefik
service remains available only through the `podokit-legacy-proxy` profile for compatibility.

OAuth providers should use a stable HTTPS development origin instead of adding local ports to a
provider client. See [OAuth development over HTTPS](oauth-development.md).

## Verifying template / module changes

The fastest signal without running servers:

```bash
node scripts/dev-app.mjs /tmp/myapp --add <module>
cd /tmp/myapp
npm run build -w myapp-api        # NestJS build
npm run build -w myapp-web        # SvelteKit build
cd apps/web && npx svelte-kit sync && npx svelte-check --tsconfig ./tsconfig.json
```

For anything auth/session related (login, admin, cookies), do a full local run
(compose + migrate + `npm run dev`) and exercise the flow in the browser — a
build passing is necessary but not sufficient.

### The standing verification app

Keep one generated app running throughout a work session (api `nest start --watch`,
web `vite dev`, plus `dev-watch` to mirror template edits). It doubles as the target
for fast spec runs — from the app's `tests/` workspace:

```bash
E2E_BASE_URL=http://localhost:5001 npx playwright test ui/settings.ui.spec.ts
```

Non-injected template files mirror live; when you change an injection target
(`auth.ts`, `app.module.ts`, a manifest `inject`) regenerate this one app with
`dev-app.mjs`. Run the Verdaccio smoke (`scripts/e2e-ci.mjs --smoke`) once when the
PR is ready for review; draft pushes use the fast CI loop — see
[testing.md](./testing.md).
The mirror renders `projectName` and `packageManager` from the generated app's
`.podokit/manifest.json`; it must never copy unresolved template placeholders.

## Testing

End-to-end/ui tests ship inside every generated app (`tests/` workspace) and run
with Playwright. See [testing.md](./testing.md) for how to run them
(`npm run test:e2e`), author them (the `@playwright/cli` loop), and verify faithfully
against a local Verdaccio registry (`scripts/e2e-ci.mjs`, mirrored by the `e2e` CI
workflow).

## Data tables

Admin list views (users, sessions, audit log, organizations, and the API
keys / passkeys / sessions tables on the account page) share one table
component, `$lib/components/data-table.svelte`, so the header, sortable columns
(asc/desc), and the pagination footer behave the same everywhere. Use it for
**every** table — do not assemble `Table.Root`/`Table.Header`/`Table.Body`
primitives by hand, whether the table is on a page or inside a dialog/modal, and
even when the row count is small enough that pagination rarely shows. The users
page is the reference implementation.

The pagination lives **inside the table footer** (`<Table.Footer>` / `tfoot`) —
`DataTable` renders `TablePagination` in a footer cell so the pager is bounded by
the table top-to-bottom. Never place a pagination control in a sibling element
below the table. Pass `perPage={0}` if a table genuinely needs no footer.

Sortable headers are the default: give every data column `sortable: true` (only
action/status-style columns stay non-sortable), and supply a `value` accessor for
nested or derived sort keys.

Define columns and render each row's cells with a `row` snippet:

```svelte
<script lang="ts">
  import * as Table from "$lib/components/ui/table";
  import DataTable, { type DataTableColumn, type SortState } from "$lib/components/data-table.svelte";

  let rows = $state<Item[]>([]);
  let page = $state(1);
  let sort = $state<SortState | null>({ key: "createdAt", dir: "desc" });

  const columns: DataTableColumn<Item>[] = [
    { key: "name", label: "Name", sortable: true },
    { key: "createdAt", label: "Created", sortable: true },
    { key: "actions", label: "", class: "w-10" }, // non-sortable
  ];
</script>

<DataTable {columns} {rows} getKey={(r) => r.id} bind:sort bind:page perPage={10} label={`${rows.length} items`}>
  {#snippet row(r)}
    <Table.Cell>{r.name}</Table.Cell>
    <Table.Cell>{r.createdAt}</Table.Cell>
    <Table.Cell><!-- actions --></Table.Cell>
  {/snippet}
</DataTable>
```

Two modes:

- **Client (default)** — pass all `rows`; sorting and paging happen in the
  component. For nested/derived sort keys, give the column a `value` accessor
  (e.g. `value: (s) => s.user.email`). Used by the users, sessions, and audit-log lists (each loads a bounded set).
- **Manual / server** — set `manualSort` + `manualPagination`, pass the server
  `total`, and refetch in `onChange` using the emitted `sort` (`sortBy` /
  `sortDirection`) and `page`. Use for very large server-side lists.

Pagination is handled inside the table's `tfoot` via `TablePagination`; don't add
a separate pager outside the table.

## Search & filters (TableToolbar)

Pair a `TableToolbar` with the `DataTable` for list views that need search or
filters, so the toolbar looks and behaves the same everywhere:

```
Filter | Role [select]  Status [select]
Search | [Email v] [input]  [ Search ]
```

- The **search field is a `select`** (`searchFields`), so a page can search by
  Email, Name, ... — free-text columns that can't be a filter.
- **Filters + search apply together** on the Search button / Enter — never per
  keystroke, and a filter `select` only stages a value until Search runs. This
  lets several filter + search conditions apply in one pass. Keep the live values
  in `search` / `filterValues` and copy them to your *applied* state in
  `onSearch` (the applied state is what the table reads).

Apply the results client-side (filter the rows you pass to `DataTable`) for
bounded lists — the users, sessions, and audit-log pages all load a bounded set
and filter/search/sort/paginate in the browser. For very large server-side
lists, drive `onSearch`/`onFilter` to refetch and use the DataTable's manual mode.

## Releasing

Releases are managed with [Changesets](https://github.com/changesets/changesets).
The model separates **landing code** from **publishing**: merging to `main` never
publishes anything, and versions climb only when a release is deliberately cut.
This lets work accumulate on `main` and ship as one release when enough has piled
up, instead of a version bump per merge.

**1. Changes accumulate.** Each PR that touches a published package adds a
changeset (`npm run changeset`; see [CONTRIBUTING.md](../CONTRIBUTING.md)). The
changeset files sit in `.changeset/` and pile up as PRs merge.

**2. The Version Packages PR.** Every push to `main` runs
[`.github/workflows/version.yml`](../.github/workflows/version.yml), which keeps a
single **"Version Packages"** PR up to date. It runs `npm run version`
(`changeset version` + template dependency synchronization + a lockfile sync) to
bump each affected package, write its per-package `CHANGELOG.md`, and update both
workspace and generated-template dependency ranges. A range-crossing bump (for
example, `0.1.x` → `0.2.0`, outside `^0.1.0`) therefore updates generated apps and
module manifests as well as workspace dependents. This PR just sits there,
growing, publishing nothing.

The Version workflow explicitly dispatches CI and
`scripts/e2e-ci.mjs --package-smoke` for the generated branch. Explicit dispatch
is necessary because GitHub suppresses recursive workflow runs for branches
updated with the default `GITHUB_TOKEN`. Packages are published to the local
Verdaccio registry and consumed by a freshly generated app through install,
migration, build, startup, and health checks. The browser feature suite is not
repeated because it already ran on the source PR; the full matrix still runs
nightly and can be dispatched manually.

> The workflow opens that PR with the default `GITHUB_TOKEN`, which needs the
> setting **"Allow GitHub Actions to create and approve pull requests"** ON (org
> Settings → Actions → General → Workflow permissions; repos inherit it). That
> setting also grants Actions the ability to *approve* PRs org-wide, which can
> satisfy required reviews — so keep branch protection on `main` strict (require a
> human review, enable *"Dismiss stale approvals when new commits are pushed"*,
> ideally CODEOWNERS). The Version workflow only **creates** the PR; it never
> approves, and it never publishes. (To keep the org policy locked down instead,
> swap the default token for a scoped `CHANGESETS_TOKEN` secret — a fine-grained
> PAT or GitHub App token with Contents + Pull requests write.)

**3. Cut the release.** When enough has accumulated, a maintainer:
1. Merges the **Version Packages** PR → the version bumps and CHANGELOGs land on
   `main`. Still nothing is published.
2. Optionally updates the curated top-level [`CHANGELOG.md`](../CHANGELOG.md) with
   a human-readable summary of the release (the per-package changelogs hold the
   mechanical detail).
3. Pushes a `vX.Y.Z` tag (conventionally the `@podosoft/podokit` CLI version).
   This triggers [`.github/workflows/release.yml`](../.github/workflows/release.yml),
   which publishes each package at its current `package.json` version to npm
   (skipping any version already on the registry, so it is idempotent). After
   every package succeeds, the same workflow publishes a GitHub Release for the
   existing tag with generated release notes. An existing GitHub Release is also
   skipped, so rerunning the workflow remains safe.

The tag push is the single, explicit publish gate — merging PRs, even the Version
Packages PR, never publishes on its own. A release is complete only when the
Release workflow succeeds, every intended npm version is visible, and
`gh release view vX.Y.Z` resolves to the same tag shown as the latest release on
GitHub. A pushed tag by itself is not a GitHub Release.

> **Running `npm run version` locally** (rarely needed — CI maintains the PR): the
> GitHub changelog formatter queries the GitHub API, so set `GITHUB_TOKEN` (e.g.
> `GITHUB_TOKEN=$(gh auth token) npm run version`).
