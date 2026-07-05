# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial repository scaffold: README, license (Apache-2.0), community health files, npm workspace root, CI workflow, issue/PR templates, Dependabot config.
- `@podosoft/podokit-template-engine`: token rendering, recursive template copy (with `dot-` file convention), and package.json deep-merge utilities.
- `@podosoft/podokit` CLI with `podo create <name>`: scaffolds a workspace from a template, with `--template`, `--dir`, and `--pm` options.
- Interactive prompts for `podo create` (template and package manager) when run in a terminal; `--yes` and non-TTY runs use defaults, and explicit flags always win.
- `templates/base`: minimal npm-workspace starter (apps/api, apps/web, env example).
- `templates/fullstack-nest-svelte` (default): NestJS API (config validation, `/health`, standard error envelope) + SvelteKit web (TailwindCSS v4, shadcn-svelte config, typesafe-i18n scaffold, server-side API proxy) + Docker Compose and k3s manifests.

### Fixed
- `fullstack-nest-svelte`: add missing `@types/express` so the generated API builds cleanly. Verified end-to-end: install, build (API + web), API starts, `/health` returns 200.

[Unreleased]: https://github.com/podosoft-dev/podokit/commits/main
