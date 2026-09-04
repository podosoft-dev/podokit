# PodoKit

PodoKit is an opinionated Bun 1.4 full-stack toolkit and CLI built around
**Elysia**, **SvelteKit**, **TailwindCSS**, **shadcn-svelte**, selectable
PostgreSQL/SQLite and distributed/local runtime providers, Docker, and k3s.

PodoKit v1 intentionally generates Bun-only applications. The CLI itself can
still be launched with `npx` or `bunx`, but generated API, web, worker,
migration, build, and unit-test processes run on Bun. Existing PodoKit 0.x
applications are not converted in place; keep them on
`@podosoft/podokit@0.17.4`.

## Quick start

```bash
npx @podosoft/podokit create my-app
cd my-app
bun install
cp .env.example .env
bunx --bun @podosoft/podokit dev watch
```

You can also create the project with Bun:

```bash
bunx --bun @podosoft/podokit create my-app
```

Open **http://my-app.localhost**. PodoKit starts one user-level Traefik gateway
on loopback port 80 and routes multiple projects by their `*.localhost`
hostnames. See [Development](docs/development.md) for profiles, migrations,
container lifecycle, and the host-process loop.

## CLI

```text
podo create <name> [options]

Options:
  --template <t>   fullstack (default) | todo | base
  --dir <path>     Target directory (default: ./<name>)
  --runtime bun    Optional explicit Bun selection
  --database <p>   postgres (default) | sqlite
  -y, --yes        Skip prompts and accept defaults
  -h, --help       Show help
```

| Command | What it does |
|---|---|
| `podo create <name>` | Scaffold a Bun 1.4 project |
| `podo add <module>` | Add a feature module and its dependencies |
| `podo remove <module>` | Remove a module while preserving local edits |
| `podo provider <command>` | Inspect or switch runtime providers with a dry-run-first workflow |
| `podo status` | Show version, modules, file tiers, and local edits |
| `podo diff` | List edited managed files |
| `podo doctor` | Check Elysia, Svelte, and Better Auth ranges |
| `podo locale <command>` | Manage JSON locales |
| `podo update [--apply]` | Preview or apply a v1 update |
| `podo eject <path…>` | Take ownership of a managed file |
| `podo dev <action>` | Manage container development through the shared gateway |
| `podo deploy <action>` | Plan, apply, verify, or roll back an exact-image release |

## Templates

| Template | Description |
|---|---|
| `fullstack` (default) | Bun + Elysia + SvelteKit foundation with Bun.SQL, selectable providers, merged OpenAPI, Docker Compose, and k3s |
| `todo` | The fullstack foundation plus a tested Bun.SQL Todo CRUD example |
| `base` | Minimal Bun workspace |

```bash
npx @podosoft/podokit create my-app
npx @podosoft/podokit create my-app --template todo
npx @podosoft/podokit create my-app --template base
npx @podosoft/podokit create local-app --database sqlite
```

The generated API uses Elysia on the request path, Bun.SQL for application
queries, provider-neutral cache, object storage, events, and jobs contracts,
and a small TypeORM layer only for versioned migrations. API documentation is
available at `/api-docs`; `/api-docs-json` merges Elysia routes, PodoKit module
routes, and Better Auth's dynamic OpenAPI document.

```text
my-app/
├── apps/
│   ├── api/     # Bun + Elysia, Bun.SQL, health, OpenAPI, error envelope
│   └── web/     # SvelteKit 5, Tailwind v4, shadcn-svelte, i18n, API proxy
├── infra/
│   ├── docker/  # PostgreSQL and optional Redis/MinIO/worker profiles
│   └── k3s/     # reference Kubernetes resources
├── tests/       # Playwright API and UI e2e suites
├── bun.lock
└── package.json
```

## Add features with modules

Bundled modules are applied directly:

```bash
cd my-app
bunx --bun @podosoft/podokit add auth
bun install
bun run --cwd apps/api migration:run
```

External modules are installed with Bun first:

```bash
bun add --dev @podosoft/podokit-module-blog
bunx --bun @podosoft/podokit add blog

bun add --dev @podosoft/podokit-module-analytics
bunx --bun @podosoft/podokit add analytics
```

`podo add` copies managed code, merges dependencies and environment examples,
and registers a `PodokitModule` in `apps/api/src/app.ts`. Routes are protected
by default. Modules explicitly register public or API-key access and use
`AuthService.requireSession()` or `requireAdmin()` where identity is needed.
See [Modules](docs/modules.md) for capabilities and endpoints.

The `admin-dashboard` module adds user/session administration, account security,
profile images, audit views, and runtime Settings for authentication providers,
SMTP, sign-up policy, and feature flags. Secrets are encrypted in the selected database
and never returned to the browser.

## Runtime providers

Use PostgreSQL, Redis, S3, Redis events, and BullMQ for a distributed server
deployment, or SQLite, bounded memory services, local files, and local jobs for
a desktop or single-process application. Existing projects can preview and apply
each selection independently:

```bash
podo provider list
podo provider set cache memory
podo provider set cache memory --apply
```

Switching never migrates or deletes data. See [Runtime providers](docs/providers.md)
for the compatibility contracts, complete local profile, backup boundary, and
single-replica constraints.

## Validation and runtime policy

Generated projects use:

```bash
bun run lint
bun run test
bun run build
bun run --cwd apps/api contract
```

Playwright officially supports Node rather than Bun. The generated
`bun run test:e2e` command uses Bun as the package manager, while `bunx
playwright` respects Playwright's Node shebang. Node LTS is therefore required
only for browser e2e tooling, not for any application runtime or build path.
See [Testing](docs/testing.md).

## Updating

PodoKit records every generated file and its ownership tier in `.podokit/`:

```bash
podo status
podo diff
podo update
podo update --apply
```

PodoKit v1 updates Bun/Elysia v1 applications only. A manifest created by
PodoKit 0.x is rejected with guidance to pin `@podosoft/podokit@0.17.4`.
There is no automatic NestJS-to-Elysia conversion because doing so safely
requires application-specific API, middleware, and persistence decisions.
See [Updating](docs/updating.md).

## Deploy

Production API and web images use `oven/bun:1.4.0-alpine`. Initialize a profile,
review an immutable plan, and apply the exact confirmation hash it prints:

```bash
podo deploy init --profile production --context production --host app.example.com
podo deploy doctor --profile production
podo deploy plan --profile production --release v1.2.3 --json
```

Public traffic enters through the SvelteKit proxy. See
[Deployment](docs/deployment.md) for secrets, migrations, verification, and
rollback.

## Repository layout

This public repository remains an npm workspace for maintaining and publishing
the CLI packages. Generated applications are Bun workspaces.

- `packages/cli` — `@podosoft/podokit`
- `packages/template-engine` — deterministic assembly and update merging
- `packages/api-client` — typed frontend request client
- `packages/contracts` — error and capability contracts
- `packages/podokit-auth` — encrypted auth configuration primitives
- `packages/runtime` — provider-neutral runtime contracts and local providers
- `packages/podokit-module-blog` — publishing, images, comments, and admin tools
- `packages/podokit-module-analytics` — GA4 consent, configuration, and reports
- `templates/` — Bun/Elysia project templates and bundled modules

```bash
npm install
npm run build
npm run lint
npm test
```

## AI coding agents

Generated projects include `AGENTS.md`, `CLAUDE.md`, editor pointers, and focused
skills for Elysia endpoints, SvelteKit routes, modules, updates, and deployment.
The optional PodoKit MCP server can be launched with either CLI host:

```bash
npx -y @podosoft/podokit-mcp
bunx --bun @podosoft/podokit-mcp
```

These tools describe and manage Bun/Elysia v1 projects; they do not migrate
legacy PodoKit 0.x applications.

## Documentation

- [Getting Started](docs/getting-started.md)
- [Templates](docs/templates.md)
- [Modules and endpoints](docs/modules.md)
- [Runtime providers](docs/providers.md)
- [Updating](docs/updating.md)
- [Development](docs/development.md)
- [Testing](docs/testing.md)
- [Deployment](docs/deployment.md)
- [Reporting a bug](docs/reporting-bugs.md)
- [Changelog](CHANGELOG.md)

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and the
[Apache-2.0 license](LICENSE).
