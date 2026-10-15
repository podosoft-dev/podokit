# Templates

`podo create --template <name>` selects one of three Bun 1.4 templates.
`--database postgres|sqlite` selects the initial database provider, defaulting to
`postgres`. Template choice and infrastructure choice are independent.

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

For a simple application, keep the Elysia/SvelteKit foundation and select
SQLite, memory cache/events, local files, and local jobs. `base` is a skeleton
with placeholder scripts, not the way to select lighter infrastructure.
`fullstack` and `todo` support either database; `base` does not include database
integration or the provider-consuming module foundation.

| Capability | Default | Other choice |
| --- | --- | --- |
| `database` | `postgres` | `sqlite` |
| `cache` | `redis` | `memory` |
| `object-storage` | `s3` | `local` |
| `events` | `redis` | `memory` |
| `jobs` | `bullmq` | `local` |

Only `database` is selected with a `create` flag. Other providers are configured
after creation using `podo provider set <capability> <provider> --apply`.
SQLite selection alone leaves the other defaults unchanged. Follow
[Getting Started](getting-started.md) for complete server and local setup steps,
or [Runtime providers](providers.md) for settings and module installation.

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

The request path uses Elysia and Bun.SQL with PostgreSQL or SQLite. TypeORM
executes PostgreSQL migrations; SQLite uses the local migration runner. Other
infrastructure is selected
through the contracts described in [Runtime providers](providers.md). The merged
OpenAPI document at `/api-docs-json` includes
Elysia, module, and Better Auth routes. `bun run --cwd apps/api contract`
compares that document with the generated project manifest.
The API reuses the merged document until the route count changes or an OpenAPI
contributor returns a different document object. A contributor should therefore
return the same object while its inputs are unchanged. The auth module keeps one
Better Auth document per auth instance, so an auth configuration rebuild
regenerates it, and a failed generation is retried on the next request.

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

### Proxy headers

The managed `apps/web/src/lib/server/backend-proxy.ts` forwards an allowlist of
request headers to the API (cookies, authorization, content negotiation,
conditional and range requests, the user agent) and relays an allowlist of
response headers back (content and caching headers, `location`, rate-limit
headers, `x-next-cursor`, and `set-cookie`). Every other header is dropped.

Add the headers your own API uses to the application-owned
`apps/web/src/lib/server/proxy-headers.ts`:

```ts
export const APP_FORWARDED_REQUEST_HEADERS: readonly string[] = ["x-api-key", "mcp-session-id"];
export const APP_RELAYED_RESPONSE_HEADERS: readonly string[] = ["x-checksum-sha256", "www-authenticate"];
```

The proxy merges these into its lists, lowercased and without duplicates. A name
that is not a valid header token, or one the proxy handles itself, fails the web
build and tests: hop-by-hop headers (`connection`, `transfer-encoding`,
`upgrade`, and the like), `host`, `content-length`, the client address headers
(`forwarded`, `x-forwarded-*`, `x-real-ip`), and on responses
`content-encoding` and `set-cookie`, which the proxy already relays. New apps
get the file empty; `podo update` creates it once in an existing app and never
overwrites it.

### Request body limits

`BODY_SIZE_LIMIT` (3 MiB in the generated `.env.example`, web Dockerfile, and
Kubernetes config) is the ceiling for every web route. adapter-bun passes it to
`Bun.serve` as `maxRequestBodySize`, so Bun enforces it before SvelteKit or the
proxy runs: a request whose `Content-Length` exceeds it gets 413 with an empty
body and a closed connection, and a chunked body without `Content-Length` fails
once it passes the limit while being read, with the same 413. Neither response
carries the error envelope.

Below that ceiling, cap individual `/api` routes in the application-owned
`apps/web/src/lib/server/body-limits.ts`:

```ts
export const APP_BODY_LIMITS: ReadonlyArray<{ pathPrefix: string; maxBytes: number }> = [
  { pathPrefix: "/api/feedback/", maxBytes: 64 * 1024 },
];
```

An entry covers its path and every path below it, matched on the decoded
request path, and the longest matching prefix wins. The proxy rejects a declared
`Content-Length` above the limit at once and otherwise counts the body as it
streams in, stopping at the limit without buffering the rest. Either way it
answers 413 with the standard envelope, code `PAYLOAD_TOO_LARGE` and
`details.maxBytes`, without contacting the API. Routes without an entry keep the
server-wide ceiling. An invalid prefix (not a static path under `/api/`) or a
`maxBytes` that is not a positive whole number fails the web build and tests.

These limits can only lower the ceiling: a `maxBytes` above `BODY_SIZE_LIMIT`
has no effect, because Bun rejects the body first. Raising `BODY_SIZE_LIMIT`
raises it for every page, form action, and endpoint, and the web process still
holds each proxied body in memory. For uploads larger than the ceiling, list the
upload route in `apiPaths` so the gateway sends it straight to the API; see
[direct API paths](deployment.md#direct-api-paths). An app that splits uploads
into chunks small enough for the web proxy can send larger parts that way.

### API server options

`main.ts` is managed, so applications set Bun server options through the
`apiServerOptions` export of the owned `apps/api/src/app.extensions.ts`:

```ts
import type { ApiServerOptionsSource } from "./config/server-options";

export const apiServerOptions: ApiServerOptionsSource = {
  maxRequestBodySize: 1024 ** 3, // bytes per request body
  idleTimeout: 120, // seconds, 0 to 255
};
```

| Option | Default | Effect |
| --- | --- | --- |
| `maxRequestBodySize` | `API_MAX_REQUEST_BODY_SIZE`, else 128 MiB (Bun's default) | Larger bodies are refused with `413` before a handler runs. |
| `idleTimeout` | 30 seconds (Elysia's default) | How long a connection may stay idle; `0` disables the timeout. |

Values in the export win over the environment. Export a function to derive
them from the validated environment instead, for example
`(env) => ({ maxRequestBodySize: Math.max(env.API_MAX_REQUEST_BODY_SIZE, 1024 ** 3) })`.
The export is optional: an `app.extensions.ts` written before it existed keeps
compiling, and `API_MAX_REQUEST_BODY_SIZE` still applies. Invalid values stop
the API at startup. Requests through the web app's `/api` proxy are also
bounded by the web server's `BODY_SIZE_LIMIT`.

## `todo`

The Todo template adds:

- an Elysia plugin for `GET/POST/PATCH/DELETE /todos`;
- a Bun.SQL repository;
- a numbered provider-aware migration;
- a SvelteKit Todo page; and
- unit/API/UI tests.

```bash
npx @podosoft/podokit create podokit --template todo --database sqlite
cd podokit
bun install
cp .env.example .env
bun run --cwd apps/api migration:run
bun run dev
```

This example uses SQLite and needs no PostgreSQL server. Add memory/local
providers before adding cache, upload, event, or job features to keep the app
free of external services; see the complete local setup in
[Getting Started](getting-started.md#small-app-with-local-providers).

| Web | API docs |
|---|---|
| ![Generated Todo app](images/todo-app.png) | ![Generated API docs](images/api-docs.png) |

## `base`

The base template contains Bun workspace metadata, placeholder API/web scripts,
and a minimal API entry point. Use it to build your own foundation. For a small
working full-stack app, use `fullstack` or `todo` with local providers instead.

## UI foundation

`fullstack` and `todo` include Svelte 5, Tailwind v4, mode-watcher,
typesafe-i18n, and shadcn-svelte primitives for forms (including `input`,
`textarea`, `select`, `checkbox`, and `switch`), cards, dialogs, menus, tables,
tabs, feedback, and navigation.

Add another official component from `apps/web`:

```bash
bunx --bun shadcn-svelte@latest add accordion progress
```

`components.json` maps the CLI's `utils`, `hooks`, and `lib` aliases to the
`#lib` import map, so vendored components import `#lib/utils.js` like the
shipped ones.

Application components should wrap the vendored primitives rather than editing
`src/lib/components/ui/**`. Colors and radius are CSS variables in `app.css`.

## Dotfile convention

Template paths named `dot-<name>` become `.<name>` in generated applications,
for example `dot-gitignore` becomes `.gitignore`.

## Modules

Use `podo add <module>` to extend either fullstack template with authentication,
administration, Redis, queues, SSE, S3 storage, uploads, rate limiting, logging,
audit, Blog, Analytics, and other features. See [Modules](modules.md).
