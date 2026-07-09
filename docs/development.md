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

```bash
cd /tmp/myapp
docker compose -f infra/docker/docker-compose.yml up -d      # postgres (+ redis)
# if the app uses the auth module, create the auth tables:
npx @better-auth/cli migrate -y --config apps/api/src/auth/auth.ts
npm run dev                    # API + web
```

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
E2E_BASE_URL=http://localhost:5173 npx playwright test ui/settings.ui.spec.ts
```

Non-injected template files mirror live; when you change an injection target
(`auth.ts`, `app.module.ts`, a manifest `inject`) regenerate this one app with
`dev-app.mjs`. Run the full Verdaccio e2e (`scripts/e2e-ci.mjs --smoke`) once per
batch of changes, as the pre-PR gate — see [testing.md](./testing.md).

## Testing

End-to-end/ui tests ship inside every generated app (`tests/` workspace) and run
with Playwright. See [testing.md](./testing.md) for how to run them
(`npm run test:e2e`), author them (the `@playwright/cli` loop), and verify faithfully
against a local Verdaccio registry (`scripts/e2e-ci.mjs`, mirrored by the `e2e` CI
workflow).

## Data tables

Admin list views (users, sessions, audit log, ...) share one table component,
`$lib/components/data-table.svelte`, so header, sortable columns (asc/desc), and
the pagination footer behave the same everywhere. Use it for any new table —
don't assemble `Table.*` primitives by hand.

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

Pagination is handled inside via `TablePagination`; don't add a separate footer.

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
