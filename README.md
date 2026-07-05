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
| `fullstack-nest-svelte` (default) | NestJS API + SvelteKit web, with Docker Compose and k3s manifests |
| `base` | Minimal npm workspace to build up from scratch |

### What the fullstack template gives you

```
my-app/
├── apps/
│   ├── api/     # NestJS: config validation, /health, global ValidationPipe,
│   │            # exception filter, standard { success, error } envelope
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

## Documentation

- [Getting Started](docs/getting-started.md)
- [Examples](examples/README.md)
- [Changelog](CHANGELOG.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Security

See [SECURITY.md](SECURITY.md) for how to report vulnerabilities.

## License

[Apache-2.0](LICENSE)
