# @podosoft/podokit

**PodoKit** is an opinionated but extensible starter toolkit and CLI for building full-stack TypeScript applications with **NestJS**, **SvelteKit**, **TailwindCSS**, **shadcn-svelte**, **Docker**, and **k3s**.

Stop rewriting the same backend bootstrap, frontend setup, environment config, health checks, Docker Compose, and CI every time you start a project. `podo create` gives you a consistent, production-minded foundation in seconds.

## Quick start

Node.js with npm remains the default:

```bash
npx @podosoft/podokit create my-app
cd my-app
npm install
cp .env.example .env
npx @podosoft/podokit dev watch
```

For the supported Bun 1.4.0 profile:

```bash
bunx --bun @podosoft/podokit create my-app --runtime bun
cd my-app
bun install
cp .env.example .env
bunx --bun @podosoft/podokit dev watch
```

Open **http://my-app.localhost**. The first project starts one user-level
Traefik gateway on loopback port 80; later projects reuse it and route by
hostname. Stop this project with `npx @podosoft/podokit dev down`. The traditional
`npm run dev` loop remains available on web port 5001 and API port 5002.

When run in a terminal, `podo create` lists the templates with descriptions and
asks which runtime and package manager to use. Pass flags (or `--yes`) to skip
the prompts.

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
| `podo locale <command>` | Add, validate, activate, deactivate, or list JSON locales |
| `podo update [--apply]` | Preview (or apply) what a version update would change |
| `podo runtime set <node\|bun> [--apply]` | Preview or apply an atomic runtime conversion |
| `podo eject <path…>` | Take ownership of a managed file so updates skip it |
| `podo dev <action>` | Watch, inspect, execute in, or stop a container stack behind the shared `*.localhost` gateway |
| `podo deploy <action>` | Plan, apply, verify, or roll back an exact-image Helm release |

## Usage

```
podo create <name> [options]

Options:
  --template <t>   Template to scaffold (default: fullstack-nest-svelte)
                     - fullstack-nest-svelte : clean NestJS + SvelteKit starter
                     - todo                  : fullstack + a Todo CRUD example
                     - base                  : minimal workspace
  --dir <path>     Target directory (default: ./<name>)
  --runtime <r>    Runtime: node | bun (default: node)
  --pm <name>      Package manager: npm | pnpm | yarn (Node only; default: npm)
  --no-ai          Skip AI agent guidance (AGENTS.md, CLAUDE.md, editor rules)
  -y, --yes        Skip prompts and accept defaults
  -h, --help       Show help
```

Generated projects include agent guidance for AI coding tools — an
[`AGENTS.md`](https://agents.md) (the open standard), a `CLAUDE.md` that imports
it, `.cursor`/`.github` pointers, and Claude Code skills under `.claude/skills/`.
Modules extend `AGENTS.md` as you add them. Use `--no-ai` to skip.

Fullstack projects also include a deployment skill under `.agents/skills/`
with a Claude pointer under `.claude/skills/`.

Examples:

```bash
# Interactive
npx @podosoft/podokit create my-app

# Non-interactive, explicit choices
npx @podosoft/podokit create my-app --template fullstack-nest-svelte --pm pnpm --yes

# Bun 1.4.0 runtime and package manager
bunx --bun @podosoft/podokit create my-app --template fullstack-nest-svelte --runtime bun --yes

# Minimal workspace
npx @podosoft/podokit create my-lib --template base --yes
```

The interactive flow asks for the runtime before the package manager. Bun uses
Bun as both runtime and package manager, so `--runtime bun` cannot be combined
with `--pm`. To convert a generated project later, preview and then apply:

```bash
podo runtime set bun
podo runtime set bun --apply
podo runtime set node --pm npm
podo runtime set node --pm npm --apply
```

The conversion updates runtime-managed scripts, Docker and CI files, resolves a
fresh target lockfile without importing the previous package manager's lock,
audits dependencies, and runs build, lint, and tests. Any failure restores the
previous files, lockfile, manifest, and `node_modules`.

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
An exact path handed over with `podo eject` remains owned even if a module also
declares it managed; if you later move or delete that file, update reports the
missing owned path instead of recreating it.

## Deploy an immutable release

```bash
podo deploy init --profile production --context production --host app.example.com
podo deploy doctor --profile production
podo deploy plan --profile production --release v1.2.3 --json
```

Apply and rollback require the exact confirmation hash from a fresh plan.
PodoKit consumes an existing namespace and Secrets, runs migrations before the
application rollout, and exposes only the SvelteKit web proxy. See the
[deployment guide](https://github.com/podosoft-dev/podokit/blob/main/docs/deployment.md).

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
├── package.json       # Node/npm or Bun workspace
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
