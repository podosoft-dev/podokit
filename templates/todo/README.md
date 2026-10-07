# {{projectName}}

Full-stack TypeScript app generated with [PodoKit](https://github.com/podosoft-dev/podokit).

- `apps/api` — Bun 1.4 + Elysia API: schema-validated env, `/health` + `/health/ready`, a Bun.SQL Todo CRUD resource backed by PostgreSQL or SQLite, merged OpenAPI at `/api-docs`, and a standard error envelope.
- `apps/web` — SvelteKit app (TailwindCSS v4, shadcn-svelte, typesafe-i18n) with a todo UI that talks to the API through a server-side proxy.
- `infra/` — Docker Compose references for external services and k3s manifests.

## Infrastructure choices

Inspect the current selections with `{{packageExecutor}} @podosoft/podokit provider list`.
New projects use these defaults unless configured otherwise:

| Capability | Default | Lightweight alternative |
| --- | --- | --- |
| Database | `postgres` | `sqlite` |
| Cache | `redis` | `memory` |
| Object storage | `s3` | `local` |
| Events | `redis` | `memory` |
| Jobs | `bullmq` | `local` |

For a simple program, prototype, or desktop app, SQLite, memory cache/events,
local files, and local jobs can run inside one API process without PostgreSQL,
Redis, or S3 services. `create --database sqlite` selects only the database;
choose the other providers after creation:

```bash
{{packageExecutor}} @podosoft/podokit provider set cache memory --apply
{{packageExecutor}} @podosoft/podokit provider set object-storage local --apply
{{packageExecutor}} @podosoft/podokit provider set events memory --apply
{{packageExecutor}} @podosoft/podokit provider set jobs local --apply
```

Apply providers before adding features, then install dependencies and merge new
`.env.example` entries into `.env`. These commands install implementation modules
and configure them; they do not move or delete data. SQLite defaults to
`./data/podokit.sqlite`, and local files to `LOCAL_STORAGE_PATH=./data/files`,
relative to the API working directory. Memory cache/events are lost on restart;
the database, files, and local job records persist. Use absolute paths and back
up the database and files together for packaged or production apps.

Use the host-process setup below to avoid Docker. The containerized loop still
requires Docker. See the PodoKit
[runtime provider guide](https://github.com/podosoft-dev/podokit/blob/main/docs/providers.md)
for server settings, Silo/AWS S3 configuration, and provider switching.

## Getting started

### Recommended: containerized development

```bash
{{packageManager}} install
cp .env.example .env
{{packageExecutor}} @podosoft/podokit dev watch
```

Open the URL printed by the command; a new project defaults to
**http://{{projectName}}.localhost**. The committed `.podokit/dev.json` is the
source of truth if you change the hostname. The first running PodoKit project starts
one user-level Traefik gateway on `127.0.0.1:80`; additional projects reuse it and
route by that hostname. Even a single app uses
the same topology, with one route and no project-specific host port.

When the API exposes WebSocket endpoints, add their exact paths to
`.podokit/dev.json` under `webSocketPaths`. The shared gateway sends only those paths
directly to the API and leaves every other path on the web app. Add `publicUrl` to the
same file when an HTTPS tunnel preserves its public `Host` header.

In a second terminal, apply the included Todo migration and use the lifecycle helpers:

```bash
{{packageExecutor}} @podosoft/podokit dev exec api {{apiRun}} migration:run
{{packageExecutor}} @podosoft/podokit dev url
{{packageExecutor}} @podosoft/podokit dev up -d # detached stack without source watching
{{packageExecutor}} @podosoft/podokit dev ps
{{packageExecutor}} @podosoft/podokit dev logs
{{packageExecutor}} @podosoft/podokit dev down
```

`dev watch` reads `.podokit/manifest.json` and automatically activates `cache`,
`storage`, and `queue` when installed modules require Redis, Silo, or a worker.
`dev up` uses the same shared gateway and module profiles without keeping Compose
Watch attached.
You can still activate an additional Compose profile explicitly:

```bash
{{packageExecutor}} @podosoft/podokit dev watch --profile dev
```

Explicit profile flags are preserved for other lifecycle commands. `dev down`
activates all profiles while removing this project's stack and route. If it is
the final registered
project, it also removes the shared gateway and network. Source changes are synced
through Compose Watch, including Vite HMR on the same portless browser origin.

### Alternative: host processes

Use this loop for an app with SQLite and local providers, or when you want the
web and API processes on the host. Prepare the project first:

```bash
{{packageManager}} install
cp .env.example .env
{{apiRun}} migration:run
```

For PostgreSQL, start `docker compose -f infra/docker/docker-compose.yml up -d`
before migrating. Redis needs `--profile cache`; Silo needs the storage overlay
added by `object-storage-s3`. Skip those services for the complete local setup.

Run each service in a separate terminal from the project root:

```bash
{{apiRun}} dev # terminal 1
```

```bash
{{webRun}} dev # terminal 2
```

- API: http://localhost:5002 — health at `/health`, docs at `/api-docs`
- Web: http://localhost:5001

For multi-project routing, container profiles, and OAuth over a stable HTTPS
tunnel, see the PodoKit [development guide](https://github.com/podosoft-dev/podokit/blob/main/docs/development.md).

## Database & migrations

The API uses Bun.SQL with the selected PostgreSQL or SQLite database. TypeORM
runs PostgreSQL migrations; SQLite uses the local migration runner. A sample
Todo repository and initial migration are included.

```bash
{{apiRun}} migration:run      # apply migrations
{{apiRun}} migration:revert   # roll back the last one
```

When `auth` is installed, use `{{apiRun}} migrate:all` to create or update both
Better Auth and application tables. Set the module's required environment
values before migrating.

## Deploy

Docker Compose lives in `infra/docker`; the basic k3s manifests in `infra/k3s`
route every public path through the web proxy. Use `podo deploy init`, `doctor`,
and `plan` for an exact-image release on Kubernetes or one Docker host. Applying
or rolling back requires the exact confirmation hash from a fresh plan. See the
PodoKit [deployment guide](https://github.com/podosoft-dev/podokit/blob/main/docs/deployment.md).

For a Docker Compose deployment with API WebSockets, list their exact paths under
`exposure.webSocketPaths`. The driver keeps one published port, routes those paths
to API, and sends every other request to web. If an external reverse proxy supplies
forwarding headers, list only its direct CIDR blocks in `exposure.trustedProxyCidrs`.
