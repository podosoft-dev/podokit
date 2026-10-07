# {{projectName}}

Generated with [PodoKit](https://github.com/podosoft-dev/podokit).

A minimal Bun 1.4 TypeScript workspace with placeholder API/web scripts. Choose
`fullstack` or `todo` when creating a project that needs the working Elysia API,
SvelteKit web app, database integration, or feature modules.

For a simple working app, those templates support SQLite, memory cache/events,
local files, and local jobs without external PostgreSQL, Redis, or S3 services.
`base` is for building your own foundation; it does not include the provider
consumers or module integration points. See
[Getting Started](https://github.com/podosoft-dev/podokit/blob/main/docs/getting-started.md).

## Getting started

```bash
{{packageManager}} install
cp .env.example .env
```

Implement the workspace scripts before running the application. The generated
`dev` commands are placeholders and do not start services.
