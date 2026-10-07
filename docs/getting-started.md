# Getting Started

PodoKit v1 generates Bun 1.4 applications with an Elysia API. The published CLI
can be launched by Node or Bun, but the generated application is Bun-only.

## Prerequisites

- Bun 1.4.0 exactly
- Docker for containerized development or locally hosted PostgreSQL, Redis, and
  Silo-backed S3 storage; a host-process app with only local providers does not
  need Docker
- Node.js 22 LTS only when running Playwright browser tests

## Choose a template and infrastructure

Template choice controls the application foundation:

| Template | What you get |
| --- | --- |
| `fullstack` (default) | Elysia API, SvelteKit web app, database integration, and module support |
| `todo` | The same foundation plus a tested Todo CRUD feature |
| `base` | A minimal workspace with placeholder scripts, for building your own foundation |

Choose infrastructure independently for `fullstack` and `todo`:

| Capability | Default | Lightweight alternative |
| --- | --- | --- |
| Database | `postgres` — PostgreSQL | `sqlite` — local database file |
| Cache | `redis` — shared cache | `memory` — in-process cache |
| Object storage | `s3` — S3-compatible service | `local` — local files |
| Events | `redis` — shared events | `memory` — in-process events |
| Jobs | `bullmq` — Redis queue and separate worker | `local` — jobs persisted in the selected database, executed inside the API |

Use the server providers when multiple API or worker processes need shared
state. For a simple program, prototype, small internal tool, or desktop app,
**SQLite + memory + local files** can avoid PostgreSQL, Redis, and S3 services.
Local cache, events, files, and jobs are designed for one API process.

`create` records provider selections; it does not install or start all optional
services. Cache, object storage, events, and jobs become available when a feature
needs them or you apply their provider. Only the database has a creation flag:
`--database postgres|sqlite`. The CLI does not prompt for all infrastructure
choices, and there are no `--cache` or `--storage` creation flags.

## Default server setup

Use either CLI host:

```bash
npx @podosoft/podokit create my-app --template fullstack --yes
# or
bunx --bun @podosoft/podokit create my-app --template fullstack --yes
```

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

The host Compose file starts PostgreSQL by default. Redis needs `--profile
cache`; Silo needs the `minio.compose.yml` overlay added by `object-storage-s3`.
The containerized `podo dev` loop detects installed module profiles. See
[Development](development.md) for these layouts.

## Small app with local providers

This example creates a working Todo app with SQLite and selects all local
providers before any features are added:

```bash
bunx --bun @podosoft/podokit create podokit --template todo --database sqlite --yes
cd podokit
bunx --bun @podosoft/podokit provider set cache memory --apply
bunx --bun @podosoft/podokit provider set object-storage local --apply
bunx --bun @podosoft/podokit provider set events memory --apply
bunx --bun @podosoft/podokit provider set jobs local --apply
bunx --bun @podosoft/podokit provider list
bun install
cp .env.example .env
bun run --cwd apps/api migration:run
```

`--database sqlite` changes only the database. The other selections otherwise
remain Redis cache, S3, Redis events, and BullMQ. `provider set --apply` installs
each selected implementation module and updates the managed configuration.
For a Todo-only app, those four optional provider commands are unnecessary;
include them when preparing for cache, uploads, events, or background work.

Run the API and web app in separate terminals from the project root:

```bash
# Terminal 1
bun run --cwd apps/api dev
```

```bash
# Terminal 2
bun run --cwd apps/web dev
```

Open **http://localhost:5001**. The API listens on **http://localhost:5002**.
This host-process layout requires no PostgreSQL, Redis, S3 service, or Docker.
`podo dev watch` is a container workflow and still requires Docker.

SQLite defaults to `./data/podokit.sqlite` and files to `./data/files`, relative
to the API working directory. Memory cache and events disappear on restart;
the database, local files, and local jobs persist. Use absolute `DATABASE_URL`
and `LOCAL_STORAGE_PATH` values for packaged or production apps, keep one API
process, and back up the database and files together. See
[Runtime providers](providers.md) for settings and switching existing data.

## Add modules

```bash
bunx --bun @podosoft/podokit add auth
bunx --bun @podosoft/podokit add admin-dashboard
bun install
```

Add modules before copying `.env.example` to `.env`. If `.env` already exists,
merge the new module's environment entries manually; `podo add` updates the
example file, not your active secrets. Set a stable `BETTER_AUTH_SECRET` and
`ADMIN_EMAILS`, then create the auth and application tables:

```bash
bun run --cwd apps/api migrate:all
```

The selected providers also apply to modules. For example, `file-upload` and
the admin dashboard's profile images use local files when `object-storage`
is `local`; they do not require S3. See [Templates](templates.md) for the
generated structure and [Modules](modules.md) for capabilities.

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
