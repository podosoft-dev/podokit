# @podosoft/podokit

**PodoKit** is an opinionated but extensible starter toolkit and CLI for building full-stack TypeScript applications with **NestJS**, **SvelteKit**, **TailwindCSS**, **shadcn-svelte**, **Docker**, and **k3s**.

Stop rewriting the same backend bootstrap, frontend setup, environment config, health checks, Docker Compose, and CI every time you start a project. `podo create` gives you a consistent, production-minded foundation in seconds.

## Quick start

```bash
npx @podosoft/podokit create my-app
cd my-app
npm install
cp .env.example .env
npm run dev
```

- API: http://localhost:3000 (health at `/health`)
- Web: http://localhost:5173

When run in a terminal, `podo create` lists the templates with descriptions and asks which one (and which package manager) to use. Pass flags (or `--yes`) to skip the prompts.

The `todo` template (`--template todo`) generates a working todo app (SvelteKit UI + NestJS API + PostgreSQL) with Swagger docs:

![Generated todo app](https://raw.githubusercontent.com/podosoft-dev/podokit/main/docs/images/todo-app.png)

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
  -y, --yes        Skip prompts and accept defaults
  -h, --help       Show help
```

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
npx @podosoft/podokit add auth-jwt   # JWT auth: register, login, guard, /auth/me
```

`podo add <module>` overlays files, merges dependencies, appends env vars, and wires the module into the NestJS app. Run `podo add` with no argument to list available modules.

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
