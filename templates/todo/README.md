# {{projectName}}

Full-stack TypeScript app generated with [PodoKit](https://github.com/podosoft-dev/podokit).

- `apps/api` — NestJS API: schema-validated env, `/health` + `/health/ready`, a `todos` CRUD resource (TypeORM + PostgreSQL), Swagger docs at `/api-docs`, and a standard error envelope.
- `apps/web` — SvelteKit app (TailwindCSS v4, shadcn-svelte, typesafe-i18n) with a todo UI that talks to the API through a server-side proxy.
- `infra/` — Docker Compose (PostgreSQL, Redis) and k3s manifests.

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
`storage`, and `queue` when installed modules require Redis, MinIO, or a worker.
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

Use this loop when you want only the web and API processes on the host:

```bash
# start local PostgreSQL + Redis
docker compose -f infra/docker/docker-compose.yml up -d

# run database migrations
{{apiRun}} migration:run

# run api + web
{{packageManager}} run dev
```

- API: http://localhost:5002 — health at `/health`, docs at `/api-docs`
- Web: http://localhost:5001

For multi-project routing, container profiles, and OAuth over a stable HTTPS
tunnel, see the PodoKit [development guide](https://github.com/podosoft-dev/podokit/blob/main/docs/development.md).

## Database & migrations

The API uses TypeORM with PostgreSQL. A sample `Todo` entity and an initial migration are included — replace them with your own domain model.

```bash
{{apiRun}} migration:run      # apply migrations
{{apiRun}} migration:revert   # roll back the last one
```

## Deploy

Docker Compose lives in `infra/docker`; the basic k3s manifests in `infra/k3s`
route every public path through the web proxy. Use `podo deploy init`, `doctor`,
and `plan` for an exact-image Helm release on an existing cluster. Applying or
rolling back requires the exact confirmation hash from a fresh plan. See the
PodoKit [deployment guide](https://github.com/podosoft-dev/podokit/blob/main/docs/deployment.md).
