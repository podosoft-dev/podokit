# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Preinstalled shadcn-svelte components** in the fullstack and todo templates (`button`, `input`, `card`, `checkbox`, `label`) with the full theme in `app.css` and a `cn` helper. The generated UIs now use real shadcn-svelte components instead of raw HTML, and the docs cover adding more components (`shadcn-svelte add`) and theming.
- **Module system: `podo add <module>`** — add composable features to an existing project. A module overlays files, merges dependencies, appends env vars, and wires itself into the NestJS app at marker comments.
- **`auth-jwt` module** — JWT authentication for the API: register, login, a JWT guard, and a protected `/auth/me` route backed by a TypeORM `users` table. Verified end-to-end: generate → `add auth-jwt` → install → build → migrate → register/login/`/auth/me`.

- **`fullstack-nest-svelte`** (default) is now a clean starter: schema-validated env (zod), `/health` + `/health/ready`, **Swagger** at `/api-docs`, and **TypeORM + PostgreSQL wired with no domain code** — you add your own entities.
- New **`todo`** template: the fullstack starter plus a worked Todo CRUD example (TypeORM entity, versioned migration, Swagger, and a SvelteKit todo UI through the server-side proxy). Verified end-to-end: install, build, `docker compose up`, `migration:run`, todo CRUD, `/api-docs`.
- The CLI now lists templates with descriptions (in prompts and `--help`).
- Screenshots of the generated todo app (web UI and API docs) in the README, templates guide, and examples.

### Changed
- Templates are now distinct: `base` (minimal), `fullstack-nest-svelte` (clean default), and `todo` (example) — instead of baking the todo example into the default template.

## [0.1.1] - 2026-07-05

### Documentation
- Add package READMEs for `@podosoft/podokit` (the npm landing page) and `@podosoft/podokit-template-engine`.
- Expand the repository README, Getting Started guide, and add a Templates guide.

## [0.1.0] - 2026-07-05

### Added
- Initial repository scaffold: README, license (Apache-2.0), community health files, npm workspace root, CI workflow, issue/PR templates, Dependabot config.
- `@podosoft/podokit-template-engine`: token rendering, recursive template copy (with `dot-` file convention), and package.json deep-merge utilities.
- `@podosoft/podokit` CLI with `podo create <name>`: scaffolds a workspace from a template, with `--template`, `--dir`, and `--pm` options.
- Interactive prompts for `podo create` (template and package manager) when run in a terminal; `--yes` and non-TTY runs use defaults, and explicit flags always win.
- `templates/base`: minimal npm-workspace starter (apps/api, apps/web, env example).
- `templates/fullstack-nest-svelte` (default): NestJS API (config validation, `/health`, standard error envelope) + SvelteKit web (TailwindCSS v4, shadcn-svelte config, typesafe-i18n scaffold, server-side API proxy) + Docker Compose and k3s manifests.

### Fixed
- `fullstack-nest-svelte`: add missing `@types/express` so the generated API builds cleanly. Verified end-to-end: install, build (API + web), API starts, `/health` returns 200.

[Unreleased]: https://github.com/podosoft-dev/podokit/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/podosoft-dev/podokit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/podosoft-dev/podokit/releases/tag/v0.1.0
