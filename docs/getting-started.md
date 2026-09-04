# Getting Started

PodoKit v1 generates Bun 1.4 applications with an Elysia API. The published CLI
can be launched by Node or Bun, but the generated application is Bun-only.

## Prerequisites

- Bun 1.4.0 exactly
- Docker when using PostgreSQL, Redis, or MinIO providers
- Node.js 22 LTS only when running Playwright browser tests

## Create a project

Use either CLI host:

```bash
npx @podosoft/podokit create my-app --template fullstack --yes
# or
bunx --bun @podosoft/podokit create my-app --template fullstack --yes
```

For an embedded database, create with `--database sqlite`. Add the local cache,
object storage, event, and job providers independently when the application must
run without external infrastructure:

```bash
bunx --bun @podosoft/podokit create local-app --database sqlite --yes
cd local-app
bunx --bun @podosoft/podokit provider set cache memory --apply
bunx --bun @podosoft/podokit provider set object-storage local --apply
bunx --bun @podosoft/podokit provider set events memory --apply
bunx --bun @podosoft/podokit provider set jobs local --apply
```

Local providers require one API process. Read [Runtime providers](providers.md)
before changing an existing project or migrating data.

Then install and start the container development loop:

```bash
cd my-app
bun install
cp .env.example .env
bunx --bun @podosoft/podokit dev watch
```

Open **http://my-app.localhost**. One user-level Traefik gateway listens on
loopback port 80 and routes each PodoKit project by hostname.

Use a second terminal for lifecycle operations:

```bash
bunx --bun @podosoft/podokit dev url
bunx --bun @podosoft/podokit dev ps
bunx --bun @podosoft/podokit dev logs
bunx --bun @podosoft/podokit dev exec api bun run --cwd apps/api migration:run
bunx --bun @podosoft/podokit dev down
```

For host processes instead of Compose Watch:

```bash
docker compose -f infra/docker/docker-compose.yml up -d
bun run --cwd apps/api migration:run
bun run dev
```

- API: http://localhost:5002 (`/health`, `/health/ready`, `/api-docs`)
- Web: http://localhost:5001

## Templates

- `fullstack` — Bun + Elysia + SvelteKit foundation with no domain feature.
- `todo` — the foundation plus a tested Bun.SQL Todo CRUD example.
- `base` — a minimal Bun workspace.

See [Templates](templates.md) for the generated structure.

## Add modules

```bash
bunx --bun @podosoft/podokit add auth
bunx --bun @podosoft/podokit add admin-dashboard
bun install
bun run --cwd apps/api migration:run
```

External modules must be installed before they are applied:

```bash
bun add --dev @podosoft/podokit-module-blog
bunx --bun @podosoft/podokit add blog

bun add --dev @podosoft/podokit-module-analytics
bunx --bun @podosoft/podokit add analytics
```

After adding `admin-dashboard`, set `ADMIN_EMAILS`, migrate, and bootstrap the
first administrator using environment injection from your shell or secret
manager:

```bash
export ADMIN_BOOTSTRAP_EMAIL="admin@example.com"
IFS= read -r -s ADMIN_BOOTSTRAP_PASSWORD && export ADMIN_BOOTSTRAP_PASSWORD
bun run --cwd apps/api admin:bootstrap
unset ADMIN_BOOTSTRAP_PASSWORD
```

The command is idempotent and does not print the password. See
[Modules](modules.md) for module dependencies, environment settings, and API
endpoints.

## Validate the generated app

```bash
bun run lint
bun run test
bun run build
bun run --cwd apps/api contract
```

The contract command creates the assembled Elysia application, merges Better
Auth's generated OpenAPI document, and fails if any expected template or module
route is missing.

For the shipped browser and HTTP e2e suite:

```bash
bun run test:e2e
```

`bunx playwright` follows Playwright's Node shebang because Playwright's official
runtime requirement is Node. This is a test-tool exception; generated services,
workers, migrations, builds, and unit tests remain Bun-only.

## Update a v1 project

```bash
podo status
podo diff
podo update
podo update --apply
```

Always review the dry run before applying. PodoKit updates managed and assembled
files, 3-way merges edited managed files, and never overwrites owned routes or
components.

PodoKit v1 does not convert PodoKit 0.x projects. A legacy manifest is rejected
with instructions to keep using:

```bash
npx @podosoft/podokit@0.17.4 <command>
```

Build a new v1 application and migrate product-specific behavior deliberately
when you want to adopt Bun and Elysia.

## Deploy

Both production images are based on Bun 1.4.0 Alpine:

```bash
docker build -f apps/api/Dockerfile -t registry.example.com/my-app-api:v1.2.3 .
docker build -f apps/web/Dockerfile -t registry.example.com/my-app-web:v1.2.3 .
```

Use `podo deploy init`, `doctor`, `plan`, and `apply` for one Docker host or a
Kubernetes cluster. See [Deployment](deployment.md).

## AI coding agents

Generated repositories include `AGENTS.md`, `CLAUDE.md`, editor pointers, and
skills for Elysia, SvelteKit, modules, updates, and deployment. `.mcp.json`
configures `@podosoft/podokit-mcp` so compatible agents can inspect and manage
the project without guessing its conventions.

Next, read [Development](development.md), [Testing](testing.md), and
[Modules](modules.md).
