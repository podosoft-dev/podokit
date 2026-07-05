# PodoKit

PodoKit is an opinionated but extensible starter toolkit for building full-stack TypeScript applications with NestJS, SvelteKit, TailwindCSS, shadcn-svelte, Docker, and k3s.

## Why PodoKit?

Modern full-stack projects repeat the same setup work: backend structure, frontend structure, shared TypeScript configuration, environment variables, Docker Compose, k3s manifests, health checks, and CI. PodoKit gives you a consistent, production-minded foundation so you can start building features instead of plumbing.

## Quick Start

```bash
npx @podosoft/podokit create my-app
```

Then:

```bash
cd my-app
npm install
npm run dev
```

## Features

- NestJS backend starter
- SvelteKit frontend starter
- TailwindCSS and shadcn-svelte preset
- PostgreSQL and Redis optional modules
- Docker Compose templates
- k3s deployment templates
- CLI-based project generation
- Extensible template module system

## Status

PodoKit is under active development and not yet stable. APIs and templates may change before v1.0.

## Documentation

- [Getting Started](docs/getting-started.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Security

See [SECURITY.md](SECURITY.md) for how to report vulnerabilities.

## License

[Apache-2.0](LICENSE)
