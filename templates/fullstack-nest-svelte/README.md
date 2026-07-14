# {{projectName}}

Full-stack TypeScript starter generated with [PodoKit](https://github.com/podosoft-dev/podokit).

- `apps/api` — NestJS API: schema-validated env (zod), `/health` + `/health/ready`, Swagger docs at `/api-docs`, a standard error envelope, and TypeORM + PostgreSQL wired up (no domain entities yet — add your own).
- `apps/web` — SvelteKit app (TailwindCSS v4, shadcn-svelte, typesafe-i18n) that talks to the API through a server-side proxy.
- `infra/` — Docker Compose (PostgreSQL, Redis) and k3s manifests.

## Getting started

```bash
{{packageManager}} install
cp .env.example .env

# start local PostgreSQL + Redis
docker compose -f infra/docker/docker-compose.yml up -d

{{packageManager}} run dev
```

- API: http://localhost:5002 — health at `/health`, docs at `/api-docs`
- Web: http://localhost:5001

## Database & migrations

The API uses TypeORM with PostgreSQL and ships no domain entities yet. Add an
entity under `apps/api/src`, register it in `src/database/data-source.ts`, then
generate and run a migration:

```bash
{{packageManager}} run migration:generate -w {{projectName}}-api -- src/migrations/Init
{{packageManager}} run migration:run -w {{projectName}}-api
```

Want a worked example? Generate the `todo` template instead:
`npx @podosoft/podokit create my-app --template todo`.

## Deploy

Docker Compose in `infra/docker`; example k3s manifests in `infra/k3s`
(use `secret.example.yaml` as a template — never commit real secrets).

Build production images from the workspace root so Docker can use the committed
lockfile and all workspace package manifests:

```bash
docker build -f apps/api/Dockerfile -t {{projectName}}-api .
docker build -f apps/web/Dockerfile -t {{projectName}}-web .
```
