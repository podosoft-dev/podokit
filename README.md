# PodoKit

PodoKit is an opinionated but extensible starter toolkit and CLI for building full-stack TypeScript applications with **NestJS**, **SvelteKit**, **TailwindCSS**, **shadcn-svelte**, **Docker**, and **k3s**.

## Why PodoKit?

Modern full-stack projects repeat the same setup work: backend structure, frontend structure, shared TypeScript configuration, environment variables, Docker Compose, k3s manifests, health checks, and CI. PodoKit gives you a consistent, production-minded foundation so you can start building features instead of plumbing.

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

## CLI

```
podo create <name> [options]

Options:
  --template <t>   fullstack-nest-svelte (default) | base
  --dir <path>     Target directory (default: ./<name>)
  --pm <name>      npm (default) | pnpm | yarn
  -y, --yes        Skip prompts and accept defaults
  -h, --help       Show help
```

Run without flags in a terminal and PodoKit prompts for the template and package manager.

## Templates

| Template | Description |
| --- | --- |
| `fullstack-nest-svelte` (default) | Clean NestJS + SvelteKit starter: config validation, health checks, Swagger, TypeORM wired (no domain code) + Docker Compose and k3s |
| `todo` | The fullstack starter plus a Todo CRUD example (DB entity, migration, UI) — a runnable reference |
| `base` | Minimal npm workspace to build up from scratch |

Pick one interactively, or pass `--template <name>`:

```bash
npx @podosoft/podokit create my-app                    # clean fullstack (default)
npx @podosoft/podokit create my-app --template todo    # worked todo example
npx @podosoft/podokit create my-app --template base    # minimal
```

### Preview — the `todo` template

`--template todo` generates a working todo app (SvelteKit UI + NestJS API + PostgreSQL) with API docs:

| Web (SvelteKit) | API docs (Swagger) |
| --- | --- |
| ![Generated todo app](docs/images/todo-app.png) | ![Generated API docs](docs/images/api-docs.png) |

### What the fullstack starter gives you

```
my-app/
├── apps/
│   ├── api/     # NestJS: zod env validation, /health + /health/ready,
│   │            # Swagger at /api-docs, TypeORM wired (add your entities),
│   │            # global ValidationPipe, standard { success, error } envelope
│   └── web/     # SvelteKit: Tailwind v4, shadcn-svelte, typesafe-i18n,
│                # server-side API proxy (browser never calls the API directly)
├── infra/
│   ├── docker/  # docker-compose: PostgreSQL, Redis (healthchecks)
│   └── k3s/     # namespace, deployments, service, ingress, secret example
├── .env.example
├── package.json # npm workspace
└── README.md
```

## Repository layout

This repo is an npm workspace:

- `packages/cli` — the `@podosoft/podokit` CLI (`podo`)
- `packages/template-engine` — token rendering, template copy, `package.json` merge
- `templates/` — project templates copied by the CLI
- `examples/` — how to generate example apps

```bash
npm install
npm run build
npm run lint
npm test
```

## Status

PodoKit is early (`0.x`). The CLI and templates work end-to-end, but APIs and templates may change before `1.0`. Feedback and issues are welcome.

## Add features with modules

Grow a project feature by feature without swapping templates:

```bash
cd my-app
npx @podosoft/podokit add auth      # full auth (better-auth): email/password, sessions, OAuth, 2FA
```

`podo add` overlays files, merges dependencies, appends env vars, and wires the
module into the NestJS app. See [docs/modules.md](docs/modules.md).

## Documentation

- [Getting Started](docs/getting-started.md)
- [Templates](docs/templates.md)
- [Modules (`podo add`)](docs/modules.md)
- [Examples](examples/README.md)
- [Changelog](CHANGELOG.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Security

See [SECURITY.md](SECURITY.md) for how to report vulnerabilities.

## License

[Apache-2.0](LICENSE)
