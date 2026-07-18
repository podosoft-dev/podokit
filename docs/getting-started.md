# Getting Started

> PodoKit is pre-1.0. The CLI and templates are under active development.

## Prerequisites

- Node.js >= 22.22.1
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
npx @podosoft/podokit dev watch
```

Open **http://my-app.localhost**. The first running project starts a user-level,
socket-free Traefik gateway on `127.0.0.1:80`. Each additional project reuses
that gateway with its own hostname, so no project-specific host port is needed.

Use a second terminal for lifecycle and container commands:

```bash
npx @podosoft/podokit dev url
npx @podosoft/podokit dev ps
npx @podosoft/podokit dev logs
npx @podosoft/podokit dev exec api npm run migration:run -w my-app-api
npx @podosoft/podokit dev down
```

`dev down` removes only the current project, including services started with any
Compose profile; you do not need to repeat the earlier `--profile` flags. When it
removes the last registered project, it also removes the shared gateway and network.
Hostname collisions and an unrelated process already owning loopback port 80 fail
with an actionable error instead of silently remapping a port. See
[development.md](development.md) for module profiles, HMR, multi-project routing,
and HTTPS OAuth tunnels.

For a quick host-process loop instead, start the dependencies and run the app on
the traditional ports:

```bash
docker compose -f infra/docker/docker-compose.yml up -d
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

After adding `admin-dashboard`, set `ADMIN_EMAILS`, build and migrate the API,
then create the initial administrator without using the public sign-up page:

```bash
export ADMIN_BOOTSTRAP_EMAIL="admin@example.com"
IFS= read -r -s ADMIN_BOOTSTRAP_PASSWORD && export ADMIN_BOOTSTRAP_PASSWORD
npm run admin:bootstrap -w my-app-api
unset ADMIN_BOOTSTRAP_PASSWORD
```

The email must be listed in `ADMIN_EMAILS`. The command is idempotent and never
prints or stores the password. See the [`admin-dashboard` module](modules.md#admin-dashboard)
for dry-run, verification, migration order, and secret-manager usage.

## AI coding agents

Your project ships with agent guidance so tools like Claude Code, Codex, and
Cursor follow the conventions from the start: an `AGENTS.md` at the root (the
open standard), a `CLAUDE.md` that imports it, `.cursor`/`.github` pointers, and
Claude Code skills under `.claude/skills/`. As you `podo add` modules, they
extend `AGENTS.md` with their own rules. Don't want them? `podo create --no-ai`.

A `.mcp.json` also wires up the **PodoKit MCP server** (`@podosoft/podokit-mcp`,
run locally via `npx` — no hosting): agents can list/add modules, check the
project status, preview updates, and search the docs directly. See
[`@podosoft/podokit-mcp`](https://www.npmjs.com/package/@podosoft/podokit-mcp).

For docs search without any install, register **GitMCP** as a remote MCP server —
`https://gitmcp.io/podosoft-dev/podokit` — which lets an AI tool query the PodoKit
docs and code straight from the public repo.

### Start a project from scratch with an AI agent

You don't even need an existing project. Register the MCP server **globally**:

```bash
claude mcp add --scope user podokit -- npx -y @podosoft/podokit-mcp
```

Then, in an empty folder, ask your agent to build one:

> "Create a fullstack PodoKit app called **blog** with auth and admin-dashboard."

The agent uses the MCP tools `list_templates` → `create_project` → `add_module`
(auth, admin-dashboard) and runs `npm install` — going from an empty directory to
a running starter in a single prompt, with the conventions already loaded.

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
- **k3s** — `infra/k3s/` (standard `Ingress` with Traefik response compression; copy
  `secret.example.yaml` to a real Secret created out-of-band)

Production Dockerfiles use the root npm workspace lockfile. Build both images
with the repository root as the context:

```bash
docker build -f apps/api/Dockerfile -t my-app-api .
docker build -f apps/web/Dockerfile -t my-app-web .
```

## Next steps

- Explore the generated `apps/api` and `apps/web`.
- Add features with [Modules (`podo add`)](modules.md).
- Add or translate languages with [Localization](localization.md).
- Learn how to [update a project (`podo update`)](updating.md).
- Read [Examples](../examples/README.md) for feature-focused walkthroughs.
