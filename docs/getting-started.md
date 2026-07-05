# Getting Started

> PodoKit is pre-1.0. The CLI and templates are under active development.

## Create a project

```bash
npx @podosoft/podokit create my-app
cd my-app
npm install
npm run dev
```

## What you get

Depending on the options you choose, PodoKit scaffolds:

- A NestJS backend (`apps/api`)
- A SvelteKit frontend (`apps/web`) with TailwindCSS and shadcn-svelte
- Optional PostgreSQL and Redis modules
- Docker Compose and/or k3s deployment templates
- A GitHub Actions CI workflow

## Configuration

All configuration uses environment variables with safe example values in `.env.example`. Copy it to `.env` and adjust:

```bash
cp .env.example .env
```

Never commit real secrets. `.env` is gitignored by default.
