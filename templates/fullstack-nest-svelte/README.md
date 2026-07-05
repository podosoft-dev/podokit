# {{projectName}}

Full-stack TypeScript app generated with [PodoKit](https://github.com/podosoft-dev/podokit).

- `apps/api` — NestJS API: schema-validated env, `/health` + `/health/ready`, a `todos` CRUD resource (TypeORM + PostgreSQL), Swagger docs at `/api-docs`, and a standard error envelope.
- `apps/web` — SvelteKit app (TailwindCSS v4, shadcn-svelte, typesafe-i18n) with a todo UI that talks to the API through a server-side proxy.
- `infra/` — Docker Compose (PostgreSQL, Redis) and k3s manifests.

## Getting started

```bash
{{packageManager}} install
cp .env.example .env

# start local PostgreSQL + Redis
docker compose -f infra/docker/docker-compose.yml up -d

# run database migrations
{{packageManager}} run migration:run -w {{projectName}}-api

# run api + web
{{packageManager}} run dev
```

- API: http://localhost:3000 — health at `/health`, docs at `/api-docs`
- Web: http://localhost:5173

## Database & migrations

The API uses TypeORM with PostgreSQL. A sample `Todo` entity and an initial migration are included — replace them with your own domain model.

```bash
{{packageManager}} run migration:run -w {{projectName}}-api      # apply migrations
{{packageManager}} run migration:revert -w {{projectName}}-api   # roll back the last one
```

## Deploy

Docker Compose in `infra/docker`; example k3s manifests in `infra/k3s`
(use `secret.example.yaml` as a template — never commit real secrets).
