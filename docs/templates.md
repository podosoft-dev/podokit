# Templates

`podo create --template <name>` selects one of three Bun 1.4 templates.
`--database postgres|sqlite` independently selects the initial database provider.

| Template | Description |
|---|---|
| `fullstack` (default) | Bun + Elysia + SvelteKit foundation without domain code |
| `todo` | Fullstack plus a tested Bun.SQL Todo CRUD example |
| `base` | Minimal Bun workspace |

The CLI accepts `--runtime bun` as an explicit selection. Node and alternative
package-manager targets do not exist in PodoKit v1.

```bash
npx @podosoft/podokit create my-app
bunx --bun @podosoft/podokit create my-app --template todo
```

## `fullstack`

```text
apps/
  api/
    src/
      main.ts              # Elysia startup and Bun.serve
      app.ts               # assembled module/plugin registrations
      app.extensions.ts    # application-owned service/module extension point
      core/                # service registry, access policy, API contract
      database/            # provider-aware Bun.SQL connection and migrations
      health/              # GET /health and /health/ready
      common/              # AppException and standard error envelope
    scripts/build.mjs      # Bun.build API, worker, and migrations
    Dockerfile             # oven/bun:1.4.0-alpine
  web/
    src/routes/            # SvelteKit pages and API proxy
    src/lib/i18n/          # English and Korean JSON catalogs
    src/lib/components/ui/ # vendored shadcn-svelte primitives
    Dockerfile             # oven/bun:1.4.0-alpine
infra/
  docker/                  # provider-aware development services
  k3s/                     # reference resources
tests/                     # Playwright API and UI e2e suites
bun.lock
```

The request path uses Elysia and Bun.SQL with PostgreSQL or SQLite. TypeORM is
present only to execute versioned migrations. Other infrastructure is selected
through the contracts described in [Runtime providers](providers.md). The merged
OpenAPI document at `/api-docs-json` includes
Elysia, module, and Better Auth routes. `bun run --cwd apps/api contract`
compares that document with the generated project manifest.

Routes are session-protected by default when `auth` is installed. Modules use
the startup service registry and explicitly register public or API-key access.
The backend always renders failures as:

```json
{
  "success": false,
  "error": {
    "code": "STABLE_CODE",
    "message": "Readable message",
    "statusCode": 400,
    "path": "/example",
    "timestamp": "2026-08-24T00:00:00.000Z"
  }
}
```

The browser calls only the SvelteKit `/api/*` proxy. Cookies and internal API
origins stay server-side.

## `todo`

The Todo template adds:

- an Elysia plugin for `GET/POST/PATCH/DELETE /todos`;
- a Bun.SQL repository;
- a numbered provider-aware migration;
- a SvelteKit Todo page; and
- unit/API/UI tests.

```bash
npx @podosoft/podokit create my-app --template todo
cd my-app
bun install
cp .env.example .env
bun run --cwd apps/api migration:run
bun run dev
```

| Web | API docs |
|---|---|
| ![Generated Todo app](images/todo-app.png) | ![Generated API docs](images/api-docs.png) |

## `base`

The base template contains the Bun workspace metadata and a minimal API entry
point. Use it when the full Elysia/SvelteKit foundation is unnecessary.

## UI foundation

`fullstack` and `todo` include Svelte 5, Tailwind v4, mode-watcher,
typesafe-i18n, and shadcn-svelte primitives for forms, cards, dialogs, menus,
tables, tabs, feedback, and navigation.

Add another official component from `apps/web`:

```bash
bunx --bun shadcn-svelte@latest add dialog badge
```

Application components should wrap the vendored primitives rather than editing
`src/lib/components/ui/**`. Colors and radius are CSS variables in `app.css`.

## Dotfile convention

Template paths named `dot-<name>` become `.<name>` in generated applications,
for example `dot-gitignore` becomes `.gitignore`.

## Modules

Use `podo add <module>` to extend either fullstack template with authentication,
administration, Redis, queues, SSE, S3 storage, uploads, rate limiting, logging,
audit, Blog, Analytics, and other features. See [Modules](modules.md).
