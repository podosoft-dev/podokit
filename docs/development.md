# Local development

How to work on PodoKit templates, modules, and packages, then verify the result
in a real generated Bun application without publishing to npm.

## Generate a local verification app

From the PodoKit monorepo root:

```bash
node scripts/dev-app.mjs /tmp/myapp
node scripts/dev-app.mjs /tmp/myapp --add auth,admin-dashboard
node scripts/dev-app.mjs /tmp/myapp --template todo --no-build
```

The helper builds the monorepo, runs the local CLI, links unpublished local
`@podosoft/*` packages, applies requested modules, and runs `bun install`.
After changing `packages/api-client`, rebuild it in the PodoKit monorepo and
refresh the generated app:

```bash
npm run build -w @podosoft/podokit-api-client
cd /tmp/myapp
bun install
```

The PodoKit monorepo itself continues to use npm and Node-based release tooling.
Generated PodoKit v1 applications use Bun 1.4.0.

### SvelteKit source imports

SvelteKit 3 projects use the `#lib/*` package import declared in
`apps/web/package.json`; Vite aliases and the removed legacy alias are not part of
the generated project. Include the real extension in every specifier, for example
`#lib/api.js`, `#lib/components/account-menu.svelte`, or
`#lib/components/ui/button/index.js`. The web TypeScript project intentionally
includes only `src` and `vite.config.ts`, so a production `build/` is never checked
again as application source by `svelte-check`.

Container image builds can resolve unpublished packages through a local
Verdaccio registry by setting `PODOKIT_NPM_REGISTRY` to a container-reachable
address. Use this only with a read-open local registry and never pass registry
tokens through the build argument.

## Run a generated application

Generated applications support two development layouts:

| | Host process | Containerized (`compose.dev.yaml`) |
| --- | --- | --- |
| Web/API | `bun run dev` on the host | Bun runs inside containers |
| Dependencies | Docker with published host ports | Internal Docker networks |
| URL | `localhost:5001` and `:5002` | `http://<project>.localhost` |
| Best fit | One quick local project | Several projects and deployment parity |

### Host process

```bash
cd /tmp/myapp
docker compose -f infra/docker/docker-compose.yml up -d
docker compose -f infra/docker/docker-compose.yml --profile dev up -d

# When auth is installed:
bunx @better-auth/cli migrate -y --config apps/api/src/auth/auth.ts
bun run --cwd apps/api migration:run

bun run dev
```

The root `dev` script starts the Elysia API on port 5002 and SvelteKit on port
5001. Redis, MinIO, Mailpit, and the SMS sink are enabled by the generated
Compose profiles only when required.

### Containerized development

```bash
cd /tmp/myapp
podo dev watch
# or use a detached stack:
podo dev up -d

# Run migrations inside the API container when auth/modules require them:
podo dev exec api bunx @better-auth/cli migrate -y --config apps/api/src/auth/auth.ts
podo dev exec api bun run migration:run
```

Use `npx @podosoft/podokit dev ...` when `podo` is not installed globally.
The shared loopback Traefik gateway routes each committed
`.podokit/dev.json` hostname to its web container. SvelteKit proxies
`/api/*` internally to Elysia, so browsers use one origin.

If the API exposes a WebSocket endpoint, add its exact path to the same file:

```json
{
  "schemaVersion": 1,
  "hostname": "myapp.localhost",
  "webSocketPaths": ["/events/ws"]
}
```

Only these exact paths are routed directly to the API; all other paths stay on the
web service. The gateway forwards cookies and proxy headers, but the API must
authenticate the upgrade request. Add `publicUrl` when a stable HTTPS tunnel sends
its public `Host` header to the loopback gateway.

`podo dev watch` delegates to Compose Watch. Vite handles web HMR and Bun's
watch process reloads the Elysia API. Use `podo dev ps`, `logs`, `exec`, and
`down` for lifecycle operations. Install native dependencies inside the target
container with `podo dev exec api bun install` when validating Linux-specific
artifacts.

OAuth providers should use a stable HTTPS development origin rather than
registering changing local ports. See
[OAuth development over HTTPS](oauth-development.md).

## Verify template and module changes

Run static gates in a freshly generated app:

```bash
node scripts/dev-app.mjs /tmp/myapp --add <module>
cd /tmp/myapp
bun run lint
bun run test
bun run build
bun run --cwd apps/api contract
```

The API build, runtime, migrations, worker, and unit tests must use Bun 1.4.0.
The contract command assembles the actual Elysia application, merges Better
Auth's generated OpenAPI schema, and verifies every expected template/module
route.

Playwright is the one Node-runtime test-tool exception. The package officially
supports Node, and `bunx playwright` intentionally respects its Node shebang.
Do not add `--bun` when running Playwright.

For authentication, cookies, browser behavior, queues, Redis, object storage,
or migrations, also exercise the feature against a live generated stack.
Run the full Verdaccio gate once per ready batch:

```bash
node scripts/e2e-ci.mjs --smoke
```

This publishes the local packages to an isolated registry, creates a fresh app
through the real CLI path, installs it with Bun, runs migrations and the API
contract, builds and starts the Bun API/worker and SvelteKit web app, then runs
the shipped Playwright suite. See [testing.md](testing.md) for the verification
levels and available modes.

## Testing

Generated applications expose:

```bash
bun run lint
bun run test
bun run build
bun run test:e2e
bun run test:e2e:api
bun run test:e2e:ui
```

Use `E2E_BASE_URL=http://myapp.localhost bun run test:e2e` against a
containerized development stack. Tests that require external IdPs or production
cloud credentials must document their manual verification boundary.

## Data tables

Admin list views (users, sessions, audit log, organizations, and the API
keys / passkeys / sessions tables on the account page) share one table
component, `#lib/components/data-table.svelte`, so the header, sortable columns
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
  import * as Table from "#lib/components/ui/table/index.js";
  import DataTable, { type DataTableColumn, type SortState } from "#lib/components/data-table.svelte";
  import { cn } from "#lib/utils.js";

  let rows = $state<Item[]>([]);
  let page = $state(1);
  let sort = $state<SortState | null>({ key: "createdAt", dir: "desc" });

  const columns: DataTableColumn<Item>[] = [
    { key: "name", label: "Name", sortable: true },
    { key: "createdAt", label: "Created", sortable: true, hideBelow: "md" },
    { key: "actions", label: "", class: "w-10" }, // non-sortable
  ];
</script>

<DataTable
  {columns}
  {rows}
  getKey={(r) => r.id}
  bind:sort
  bind:page
  perPage={10}
  ariaLabel="Items"
  label={`${rows.length} items`}
>
  {#snippet row(r, { cellClass })}
    <Table.Cell class={cellClass("name")}>{r.name}</Table.Cell>
    <Table.Cell class={cn(cellClass("createdAt"), "text-muted-foreground")}>{r.createdAt}</Table.Cell>
    <Table.Cell class={cellClass("actions")}><!-- actions --></Table.Cell>
  {/snippet}
</DataTable>
```

For responsive tables, set `hideBelow` to `sm`, `md`, `lg`, or `xl` and apply
the row context's `cellClass(columnKey)` to the matching cell. The header and
cell then share the same static Tailwind class, so hiding a column cannot shift
the remaining cells. Existing one-argument row snippets remain valid when no
responsive column behavior is needed. Give each table an `ariaLabel` when a
page or dialog can contain more than one table; tests should scope pagination
and row assertions to that table.

Two modes:

- **Client (default)** — pass all `rows`; sorting and paging happen in the
  component. For nested/derived sort keys, give the column a `value` accessor
  (e.g. `value: (s) => s.user.email`). Used by the users, sessions, and audit-log lists (each loads a bounded set).
- **Manual / server** — set `manualSort` + `manualPagination`, pass the server
  `total`, and refetch in `onChange` using the emitted `sort` (`sortBy` /
  `sortDirection`) and `page`. Use for very large server-side lists.

Pagination is handled inside the table's `tfoot` via `TablePagination`; don't add
a separate pager outside the table.

## Mobile safe areas

The generated viewport is deliberately safe by default:
`width=device-width, initial-scale=1`. Add `viewport-fit=cover` only when an
application-owned layout intentionally renders edge to edge and also applies
`env(safe-area-inset-top)`, `env(safe-area-inset-right)`,
`env(safe-area-inset-bottom)`, and `env(safe-area-inset-left)` padding where
needed. Enabling cover without those layout rules can place controls under a
notch or home indicator.

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
