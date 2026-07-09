# Getting Started

> PodoKit is pre-1.0. The CLI and templates are under active development.

## Prerequisites

- Node.js >= 20
- npm (or pnpm / yarn)
- Docker (optional, for local PostgreSQL and Redis)

## Create a project

```bash
npx @podosoft/podokit create my-app
```

Run in a terminal, PodoKit prompts for the template and package manager. To skip prompts:

```bash
npx @podosoft/podokit create my-app --template fullstack-nest-svelte --pm npm --yes
```

Then:

```bash
cd my-app
npm install
cp .env.example .env
npm run dev
```

- API: http://localhost:5002 — health check at `/health`
- Web: http://localhost:5001

## Templates

- **`fullstack-nest-svelte`** (default) — NestJS API + SvelteKit web + Docker/k3s.
- **`base`** — a minimal npm workspace when you want to build up from scratch.

See [templates.md](templates.md) for what each generates.

## Local services (PostgreSQL, Redis)

The fullstack template ships a Docker Compose file:

```bash
docker compose -f infra/docker/docker-compose.yml up -d
```

## Configuration

All configuration uses environment variables with safe example values in `.env.example`:

```bash
cp .env.example .env
```

The API validates required variables on startup and fails fast if something is missing. **Never commit real secrets** — `.env` is gitignored by default.

## Project scripts

The generated workspace forwards scripts to `apps/*`:

```bash
npm run dev     # run api + web in watch mode
npm run build   # build all apps
npm run lint    # type-check / lint all apps
npm test        # run tests
```

## Deployment

- **Docker Compose** — `infra/docker/`
- **k3s** — `infra/k3s/` (standard `Ingress`; copy `secret.example.yaml` to a real Secret created out-of-band)

## Next steps

- Explore the generated `apps/api` and `apps/web`.
- Read [Examples](../examples/README.md) for feature-focused walkthroughs.
