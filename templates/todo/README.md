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
npx @podosoft/podokit dev watch
```

Open the URL printed by the command; a new project defaults to
**http://{{projectName}}.localhost**. The committed `.podokit/dev.json` is the
source of truth if you change the hostname. The first running PodoKit project starts
one user-level Traefik gateway on `127.0.0.1:80`; additional projects reuse it and
route by that hostname. Even a single app uses
the same topology, with one route and no project-specific host port.

In a second terminal, apply the included Todo migration and use the lifecycle helpers:

```bash
npx @podosoft/podokit dev exec api npm run migration:run -w {{projectName}}-api
npx @podosoft/podokit dev url
npx @podosoft/podokit dev ps
npx @podosoft/podokit dev logs
npx @podosoft/podokit dev down
```

If installed modules require extra services, use their profiles on the initial
watch command instead:

```bash
npx @podosoft/podokit dev watch \
  --profile cache --profile storage --profile queue
```

Pass the same profile flags to other lifecycle commands when applicable. `dev down`
removes this project's stack and route. If it is the final registered
project, it also removes the shared gateway and network. Source changes are synced
through Compose Watch, including Vite HMR on the same portless browser origin.

### Alternative: host processes

Use this loop when you want only the web and API processes on the host:

```bash
# start local PostgreSQL + Redis
docker compose -f infra/docker/docker-compose.yml up -d

# run database migrations
{{packageManager}} run migration:run -w {{projectName}}-api

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
{{packageManager}} run migration:run -w {{projectName}}-api      # apply migrations
{{packageManager}} run migration:revert -w {{projectName}}-api   # roll back the last one
```

## Deploy

Docker Compose in `infra/docker`; example k3s manifests in `infra/k3s`
(use `secret.example.yaml` as a template — never commit real secrets).
