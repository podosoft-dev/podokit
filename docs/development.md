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
   `file:<repo>/packages/api-client` (re-packed on every install),
4. applies any `--add` modules,
5. runs `npm install`.

## Iterating on the api-client

After editing `packages/api-client`:

```bash
npm run build -w @podosoft/podokit-api-client   # in the monorepo
# then, in the generated app:
npm install                                     # picks up the new local build
```

## Running the generated app

There are **two ways** to run a generated app while you develop. Both are supported;
pick per situation.

| | **A. Host process** (traditional) | **B. Containerized** (`compose.dev.yaml`) |
|---|---|---|
| App (web/api) | run on your host (`npm run dev`) | run in containers |
| Databases | Docker, **host ports published** (5432, 6379, 9000) | Docker, **no host ports** (internal only) |
| Reach the app | `localhost:5001` / `:5002` | `http://app.localhost` (one Traefik port) |
| Multiple projects at once | ports collide — you remap by hand | never collide — only Traefik binds a port |
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
containers, only Traefik binds a host port, and you edit source on your host as usual.

```bash
cd /tmp/myapp
docker compose -f compose.dev.yaml watch                         # core stack
# with modules that need extra services, enable their profiles:
docker compose -f compose.dev.yaml \
  --profile cache --profile storage --profile queue watch
# first run only — create the tables (in the api container):
docker compose -f compose.dev.yaml exec api \
  npx @better-auth/cli migrate -y --config apps/api/src/auth/auth.ts
docker compose -f compose.dev.yaml exec api npm run migration:run -w myapp-api
```

Open **http://app.localhost** (browsers resolve `*.localhost` to 127.0.0.1 automatically).

What you get:

- **One host port.** Only Traefik publishes `:80` (dashboard on `127.0.0.1:8080`). `postgres`,
  `redis`, `minio`, and even the `api` have **no published ports** — they talk to each other by
  service name on an internal network, so this stack never collides with other projects. To run
  **several** containerized stacks at once (which would otherwise fight over `:80`), publish
  Traefik on another port with `TRAEFIK_PORT` — HMR follows automatically (next bullet).
- **Changing the published port.** `TRAEFIK_PORT` sets the host port Traefik binds (default 80):
  `TRAEFIK_PORT=8001 docker compose -f compose.dev.yaml watch` serves the app at
  **http://app.localhost:8001**. compose passes the same value to the web container as
  `VITE_HMR_CLIENT_PORT`, so Vite's HMR WebSocket targets that port. Without it the HMR socket
  connects to `:80`, fails, and Vite silently falls back to a **full page reload on every edit**
  (which also wipes any in-progress form input). `TRAEFIK_DASHBOARD_PORT` (default 8080) does the
  same for the dashboard. Set them inline as above or in the project `.env`.
- **Single entry.** The browser normally calls the web origin (`app.localhost`); SvelteKit
  proxies `/api/*` to the api container internally. Traefik routes any host on its dedicated port to the web service
  and compresses eligible HTML, JSON, CSS, and JavaScript responses according to the browser's
  `Accept-Encoding` header (see `infra/traefik/dynamic.yml`). The dedicated proxy also accepts
  literal `localhost`, which is required for OAuth providers whose HTTP development exception does
  not accept custom `*.localhost` names. Keep the entire OAuth round trip on one hostname.
- **Live edits.** `docker compose watch` syncs your source into the containers. The web has
  instant Vite HMR; an **API** source change restarts the api service (~5s) — the stable
  approach for NestJS in a container (its in-process watcher doesn't reliably respawn).
- **Profiles match modules** (same names as above): `cache` (redis), `storage` (minio),
  `queue` (worker). A minimal app needs none; enable the ones your app uses.
- **Editors & AI agents inside the container.** `.devcontainer/devcontainer.json` lets VS Code
  ("Reopen in Container") and Dev-Container-aware agents attach *inside* the container, where
  `node_modules`, TypeScript, and `git` all resolve. Install/upgrade packages in the container
  (`docker compose exec api npm install …`) so native binaries match Linux.

Prefer the host `npm run dev` loop for quick single-project work; reach for the containerized
loop when you run several projects at once or want dev to mirror the k3s/Traefik production
topology. These files (`compose.dev.yaml`, `Dockerfile.dev`, `.devcontainer/`, `.env.docker`,
`infra/traefik/`) are yours to edit — `podo update` never touches them. New projects include the
compression middleware by default; existing projects can adopt the corresponding
`infra/traefik/dynamic.yml` template change manually because this directory is owned.

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
`dev-app.mjs`. Run the full Verdaccio e2e (`scripts/e2e-ci.mjs --smoke`) once per
batch of changes, as the pre-PR gate — see [testing.md](./testing.md).
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
(`changeset version` + a lockfile sync) to bump each affected package, write its
per-package `CHANGELOG.md`, and update internal dependency ranges — so a
range-crossing bump (e.g. a dependency going `0.1.x` → `0.2.0`, outside `^0.1.0`)
updates dependents automatically. This PR just sits there, growing, publishing
nothing.

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
   (skipping any version already on the registry, so it is idempotent).

The tag push is the single, explicit publish gate — merging PRs, even the Version
Packages PR, never publishes on its own.

> **Running `npm run version` locally** (rarely needed — CI maintains the PR): the
> GitHub changelog formatter queries the GitHub API, so set `GITHUB_TOKEN` (e.g.
> `GITHUB_TOKEN=$(gh auth token) npm run version`).
