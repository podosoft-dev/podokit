# {{projectName}}

Full-stack TypeScript app generated with [PodoKit](https://github.com/podosoft-dev/podokit).

- `apps/api` — NestJS API (config validation, health checks, standard error envelope)
- `apps/web` — SvelteKit app (TailwindCSS v4, shadcn-svelte, typesafe-i18n) that talks to the API through a server-side proxy
- `infra/` — Docker Compose and k3s manifests

## Getting started

```bash
{{packageManager}} install
cp .env.example .env
{{packageManager}} run dev
```

- API: http://localhost:3000 (health at `/health`)
- Web: http://localhost:5173

## Local services

```bash
docker compose -f infra/docker/docker-compose.yml up -d
```

## Deploy

Docker Compose manifests live in `infra/docker`; example k3s manifests in `infra/k3s`
(use `secret.example.yaml` as a template — never commit real secrets).
