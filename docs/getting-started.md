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
- **`todo`** — the fullstack starter plus a runnable Todo CRUD example.
- **`base`** — a minimal npm workspace when you want to build up from scratch.

See [templates.md](templates.md) for what each generates.

## Add features (`podo add`)

Grow a project feature by feature — add authentication, an admin dashboard,
Redis, queues, and more without swapping templates:

```bash
cd my-app
npx @podosoft/podokit add auth              # better-auth: email/password, sessions, OAuth, 2FA
npx @podosoft/podokit add admin-dashboard   # a full admin console (also adds auth)
```

See [modules.md](modules.md) for the full list.

## AI coding agents

Your project ships with agent guidance so tools like Claude Code, Codex, and
Cursor follow the conventions from the start: an `AGENTS.md` at the root (the
open standard), a `CLAUDE.md` that imports it, `.cursor`/`.github` pointers, and
Claude Code skills under `.claude/skills/`. As you `podo add` modules, they
extend `AGENTS.md` with their own rules. Don't want them? `podo create --no-ai`.

## Keep your project up to date

Your project records how it was assembled in a committed `.podokit/` directory,
so it can receive template and module improvements later without losing your
changes:

```bash
podo status          # version, modules, and which managed files you've edited
podo update          # preview what a newer PodoKit version would change
podo update --apply  # apply it (files you own are never touched)
```

See [updating.md](updating.md).

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
- Add features with [Modules (`podo add`)](modules.md).
- Learn how to [update a project (`podo update`)](updating.md).
- Read [Examples](../examples/README.md) for feature-focused walkthroughs.
