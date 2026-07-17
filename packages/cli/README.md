# @podosoft/podokit

**PodoKit** is an opinionated but extensible starter toolkit and CLI for building full-stack TypeScript applications with **NestJS**, **SvelteKit**, **TailwindCSS**, **shadcn-svelte**, **Docker**, and **k3s**.

Stop rewriting the same backend bootstrap, frontend setup, environment config, health checks, Docker Compose, and CI every time you start a project. `podo create` gives you a consistent, production-minded foundation in seconds.

## Quick start

```bash
npx @podosoft/podokit create my-app
cd my-app
npm install
cp .env.example .env
npx @podosoft/podokit dev watch
```

Open **http://my-app.localhost**. The first project starts one user-level
Traefik gateway on loopback port 80; later projects reuse it and route by
hostname. Stop this project with `npx @podosoft/podokit dev down`. The traditional
`npm run dev` loop remains available on web port 5001 and API port 5002.

When run in a terminal, `podo create` lists the templates with descriptions and asks which one (and which package manager) to use. Pass flags (or `--yes`) to skip the prompts.

The `todo` template (`--template todo`) generates a working todo app (SvelteKit UI + NestJS API + PostgreSQL) with Swagger docs:

![Generated todo app](https://raw.githubusercontent.com/podosoft-dev/podokit/main/docs/images/todo-app.png)

## Commands

| Command | What it does |
|---|---|
| `podo create <name>` | Scaffold a new project from a template |
| `podo add <module>` | Add a feature module (auth, admin-dashboard, redis, …) to a project |
| `podo status` | Show the PodoKit version, modules, file tiers, and local edits |
| `podo diff` | List the PodoKit-managed files you've edited since generation |
| `podo doctor` | Check framework versions against the supported ranges |
| `podo update [--apply]` | Preview (or apply) what a version update would change |
| `podo eject <path…>` | Take ownership of a managed file so updates skip it |
| `podo dev <action>` | Watch, inspect, execute in, or stop a container stack behind the shared `*.localhost` gateway |

## Usage

```
podo create <name> [options]

Options:
  --template <t>   Template to scaffold (default: fullstack-nest-svelte)
                     - fullstack-nest-svelte : clean NestJS + SvelteKit starter
                     - todo                  : fullstack + a Todo CRUD example
                     - base                  : minimal npm workspace
  --dir <path>     Target directory (default: ./<name>)
  --pm <name>      Package manager: npm | pnpm | yarn (default: npm)
  --no-ai          Skip AI agent guidance (AGENTS.md, CLAUDE.md, editor rules)
  -y, --yes        Skip prompts and accept defaults
  -h, --help       Show help
```

Generated projects include agent guidance for AI coding tools — an
[`AGENTS.md`](https://agents.md) (the open standard), a `CLAUDE.md` that imports
it, `.cursor`/`.github` pointers, and Claude Code skills under `.claude/skills/`.
Modules extend `AGENTS.md` as you add them. Use `--no-ai` to skip.

Examples:

```bash
# Interactive
npx @podosoft/podokit create my-app

# Non-interactive, explicit choices
npx @podosoft/podokit create my-app --template fullstack-nest-svelte --pm pnpm --yes

# Minimal workspace
npx @podosoft/podokit create my-lib --template base --yes
```

## Add features with modules

```bash
cd my-app
npx @podosoft/podokit add auth      # full auth (better-auth): email/password, sessions, OAuth, 2FA
```

`podo add <module>` overlays files, merges dependencies, appends env vars, and wires the module into the NestJS app. Run `podo add` with no argument to list available modules.

The **`admin-dashboard`** module adds a ready-made admin console on top of `auth` — login/signup pages, user & session management, an audit log, and a Settings page where OAuth providers, SMTP, and server toggles are configured at runtime (stored encrypted in the DB, applied without a restart):

![PodoKit admin dashboard — users](https://raw.githubusercontent.com/podosoft-dev/podokit/main/docs/images/admin-users.png)

## Keep your project up to date

Every generated project records how it was assembled in a committed `.podokit/`
directory, so it can receive template and module improvements later without
losing your work:

```bash
podo status          # version, modules, and which managed files you've edited
podo update          # preview what a newer PodoKit version would change
podo update --apply  # apply it: clean updates are written, your edits are 3-way merged
```

Files you own (routes, your components, shadcn UI) are never touched. See the
[updating guide](https://github.com/podosoft-dev/podokit/blob/main/docs/updating.md).

## What you get (`fullstack-nest-svelte`)

```
my-app/
├── apps/
│   ├── api/           # NestJS: config validation, /health, global
│   │   └── src/       # ValidationPipe, standard error envelope
│   └── web/           # SvelteKit: Tailwind v4, shadcn-svelte,
│       └── src/       # typesafe-i18n, server-side API proxy
├── infra/
│   ├── docker/        # docker-compose (PostgreSQL, Redis)
│   └── k3s/           # namespace, deployments, service, ingress, secret example
├── .env.example
├── package.json       # npm workspace
└── README.md
```

Highlights of the generated app:

- **Backend (NestJS)** — bootstrap with a global `ValidationPipe` and exception filter, typed environment validation, a `/health` endpoint, and a stable `{ success, error: { code, ... } }` response envelope.
- **Frontend (SvelteKit)** — TailwindCSS v4 (config-less), **shadcn-svelte components preinstalled** (button, input, card, checkbox, label), a typesafe-i18n scaffold, and a **server-side proxy** so the browser never calls the API directly.
- **Infra** — Docker Compose for local PostgreSQL and Redis, plus example k3s manifests (standard `Ingress`, `secret.example.yaml`).

## Status

PodoKit is early (`0.x`). The CLI and templates work end-to-end, but APIs and templates may change before `1.0`. Feedback and issues are welcome.

## Links

- Repository & issues: https://github.com/podosoft-dev/podokit
- Changelog: https://github.com/podosoft-dev/podokit/blob/main/CHANGELOG.md

## License

[Apache-2.0](https://github.com/podosoft-dev/podokit/blob/main/LICENSE)
