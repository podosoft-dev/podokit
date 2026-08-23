# PodoKit

PodoKit is an opinionated but extensible starter toolkit and CLI for building full-stack TypeScript applications with **NestJS**, **SvelteKit**, **TailwindCSS**, **shadcn-svelte**, **Docker**, and **k3s**.

## Why PodoKit?

Modern full-stack projects repeat the same setup work: backend structure, frontend structure, shared TypeScript configuration, environment variables, Docker Compose, k3s manifests, health checks, and CI. PodoKit gives you a consistent, production-minded foundation so you can start building features instead of plumbing.

## Quick start

Node.js with npm remains the default:

```bash
npx @podosoft/podokit create my-app
cd my-app
npm install
cp .env.example .env
npx @podosoft/podokit dev watch
```

Or generate a Bun-native project with the pinned Bun 1.4.0 profile:

```bash
bunx --bun @podosoft/podokit create my-app --runtime bun
cd my-app
bun install
cp .env.example .env
bunx --bun @podosoft/podokit dev watch
```

Open **http://my-app.localhost**. The first running project starts one user-level
Traefik gateway on loopback port 80; additional projects reuse it and route by
their own `*.localhost` hostname. Stop this project with
`npx @podosoft/podokit dev down`. See [Development](docs/development.md) for
profiles, migrations, lifecycle commands, and the alternative host-process loop.

## CLI

```
podo create <name> [options]

Options:
  --template <t>   fullstack-nest-svelte (default) | todo | base
  --dir <path>     Target directory (default: ./<name>)
  --runtime <r>    node (default) | bun
  --pm <name>      npm (default) | pnpm | yarn (Node only)
  -y, --yes        Skip prompts and accept defaults
  -h, --help       Show help
```

Run without flags in a terminal and PodoKit prompts for the template, runtime,
and (for Node) package manager. Bun projects use Bun as both runtime and package
manager; combining `--runtime bun` with `--pm` is rejected.

| Command | What it does |
|---|---|
| `podo create <name>` | Scaffold a new project from a template |
| `podo add <module>` | Add a feature module (auth, admin-dashboard, redis, …) |
| `podo remove <module>` | Un-apply a module (inverse of add; keeps your edits) |
| `podo status` | Version, modules, file tiers, and local edits |
| `podo diff` | Managed files you've edited since generation |
| `podo doctor` | Framework versions vs. supported ranges |
| `podo locale <command>` | Add, validate, activate, deactivate, or list JSON locales |
| `podo update [--apply]` | Preview or apply a version update (3-way merges your edits) |
| `podo runtime set <node\|bun> [--apply]` | Preview or apply an atomic runtime conversion |
| `podo eject <path…>` | Take ownership of a managed file |
| `podo dev <action>` | Run container development through the shared portless `*.localhost` gateway (`npx @podosoft/podokit dev …` without a global install) |
| `podo deploy <action>` | Plan, apply, verify, or roll back an exact-image release on an existing Kubernetes cluster or Docker host |

## Templates

| Template | Description |
| --- | --- |
| `fullstack-nest-svelte` (default) | Clean NestJS + SvelteKit starter: config validation, health checks, Swagger, TypeORM wired (no domain code) + Docker Compose and k3s |
| `todo` | The fullstack starter plus a Todo CRUD example (DB entity, migration, UI) — a runnable reference |
| `base` | Minimal Node/npm or Bun workspace to build up from scratch |

Pick one interactively, or pass `--template <name>`:

```bash
npx @podosoft/podokit create my-app                    # clean fullstack (default)
npx @podosoft/podokit create my-app --template todo    # worked todo example
npx @podosoft/podokit create my-app --template base    # minimal
bunx --bun @podosoft/podokit create my-app --runtime bun # Bun 1.4.0
```

## Runtime profiles

PodoKit formally supports Node.js 22.22.1+ with npm, pnpm, or yarn, and an exact
Bun 1.4.0 profile. The Bun profile supplies Bun lockfiles, scripts, Docker
images, Compose commands, and GitHub Actions setup; its validation runs the
NestJS suite with `bun test` and the SvelteKit suite with Vitest under Bun.

Convert an existing generated project with a dry-run first:

```bash
podo runtime set bun
podo runtime set bun --apply

podo runtime set node --pm npm
podo runtime set node --pm npm --apply
```

Conversion checks the target runtime version, 3-way merges edited managed files,
installs dependencies, audits high-severity advisories, then runs build, lint,
and tests. The manifest and source lockfile change only after every gate passes;
on failure, files, lockfiles, and the previous `node_modules` are restored. See
[Updating](docs/updating.md#changing-the-runtime).

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
├── package.json # Node/npm or Bun workspace
└── README.md
```

## Repository layout

This repo is an npm workspace. Published packages:

- `packages/cli` — the `@podosoft/podokit` CLI (`podo`)
- `packages/template-engine` — `@podosoft/podokit-template-engine`: token rendering, in-memory assembly, fenced-region wiring, and 3-way merge
- `packages/api-client` — `@podosoft/podokit-api-client`: typed API client the generated frontend uses (better-auth + JSON/multipart error-envelope request layer)
- `packages/contracts` — `@podosoft/podokit-contracts`: capabilities, upload policies, the error envelope, and `AppException` shared by backend and frontend
- `packages/podokit-auth` — `@podosoft/podokit-auth`: the DB-backed auth configuration pipeline (encrypted secrets, config store)
- `packages/podokit-module-blog` — `@podosoft/podokit-module-blog`: draft-first publishing, visibility controls, image uploads, comments, ownership, and admin management as an external updateable module
- `packages/podokit-module-analytics` — `@podosoft/podokit-module-analytics`: provider-neutral collection, consent, encrypted configuration, and aggregate administrator reports with GA4 as the first provider
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

External package modules use the same workflow after installation. For example:

```bash
npm install --save-dev @podosoft/podokit-module-blog
podo add blog
```

For privacy-aware visitor measurement and administrator reports:

```bash
npm install --save-dev @podosoft/podokit-module-analytics
podo add analytics
```

The **`admin-dashboard`** module adds a full admin console on top of `auth`:
user & session management, self-service profile-image uploads, an audit log, and a Settings page where OAuth
providers, SMTP, provider-independent sign-up approval, automatic logout, and server toggles are
configured at runtime (encrypted in the DB, applied without a restart). Pending
registrations are approved from `/admin/users`, and the generated
`admin:bootstrap` command creates or verifies the first administrator without
using the public sign-up page. Its shared avatar menu is installed on the starter
landing page and reused by the default blog layout. The separate `auth:configure` command automates
applying provider/SMTP credentials. Both workflows keep passwords and provider
secrets out of source files and logs; see [the module guide](docs/modules.md#admin-dashboard).
The generated `(admin)` route group and `admin-sidebar.svelte` are reserved for
the `/admin/*` console. Put signed-in product pages in the shell-free `(app)`
group or in an application-owned protected layout.

![PodoKit admin dashboard — Settings, social login](docs/images/admin-settings-social.png)

## Keep your project up to date

Every generated project records how it was assembled in a committed `.podokit/`
directory (template, modules, and a per-file ownership tier), so it can receive
template and module improvements later without losing your work:

```bash
podo status          # version, modules, and which managed files you've edited
podo update          # preview what a newer PodoKit version would change
podo update --apply  # apply it — clean updates written, your edits 3-way merged
```

Files you own (routes, your components, shadcn UI) are never touched. See
[docs/updating.md](docs/updating.md).

## Deploy

PodoKit binds an application-owned deployment profile to an explicit target —
a Kubernetes context, or a Docker host when one machine is the whole deployment —
renders module-aware resources, runs migrations with the exact API image, and
rolls out matching API/web SemVer tags:

```bash
podo deploy init --profile production --context production --host app.example.com
podo deploy doctor --profile production
podo deploy plan --profile production --release v1.2.3 --json
```

Applying or rolling back requires the exact hash from a freshly computed plan.
The profile contains secret names, never secret values, and public traffic always
enters through the SvelteKit web proxy.

Generated projects also ship `.github/workflows/release.yml`, which builds and
pushes both images when you tag `vX.Y.Z`. **Check which runner it uses before the
first tag**: GitHub-hosted runners are free for public repositories only, and a
private repository is billed for them. And while developing against a Compose
deployment, `podo deploy sync` copies local build output into the running
containers instead of round-tripping a release.

See [deployment](docs/deployment.md).

## AI coding agents

Generated projects come ready for AI coding tools. `podo create` writes an
[`AGENTS.md`](https://agents.md) — the open standard read by Codex, Cursor,
Copilot, Gemini, and more — describing the stack, commands (web :5001 / api
:5002), code style (Svelte 5 runes, shadcn-svelte + shared `DataTable`, the
error-code envelope), and the `podo` tooling. `CLAUDE.md` imports it
(`@AGENTS.md`) for Claude Code, with thin `.cursor/rules` and
`.github/copilot-instructions.md` pointers included too. Claude Code **skills**
(`.claude/skills/`) add procedural know-how (scaffolding a NestJS endpoint or a
SvelteKit route, using the DataTable, running `podo add`/`podo update`, and safely
configuring Google/Apple OAuth plus SMTP); modules
extend `AGENTS.md` with their own conventions as you add them. Skip it all with
`podo create --no-ai`.

Projects also ship a `.mcp.json` wiring up the **PodoKit MCP server**
([`@podosoft/podokit-mcp`](packages/mcp/README.md)) — run locally via `npx` for
Node or `bunx --bun` for Bun, with no hosting — so agents can list/add modules,
check project status, preview updates, and search the docs. And you can point any
MCP-capable tool at the docs remotely
with **GitMCP** (no install): register the URL
`https://gitmcp.io/podosoft-dev/podokit`, e.g. for Cursor/Claude Code:

```json
{ "mcpServers": { "podokit-docs": { "url": "https://gitmcp.io/podosoft-dev/podokit" } } }
```

A repo-root [`llms.txt`](llms.txt) gives LLMs a curated index of these docs.

### Start a project from scratch with an AI agent

Register the MCP server **globally** so it's available before any project exists:

```bash
# Node
claude mcp add --scope user podokit -- npx -y @podosoft/podokit-mcp
# Bun
claude mcp add --scope user podokit -- bunx --bun @podosoft/podokit-mcp
# Cursor/Codex: add the same command in their MCP settings
```

Then, in an empty folder, tell your agent:

> "Create a fullstack PodoKit app called **blog** with auth and admin-dashboard."

It calls `list_templates` → `create_project` → `add_module` and installs with
the selected Node or Bun toolchain — from nothing to a running starter in one
prompt, with the conventions already loaded from `AGENTS.md`.

## Documentation

- [Getting Started](docs/getting-started.md)
- [Templates](docs/templates.md)
- [Modules (`podo add`)](docs/modules.md)
- [Localization and JSON catalogs](docs/localization.md)
- [Updating a project (`podo update`)](docs/updating.md)
- [Examples](examples/README.md)
- [Development](docs/development.md) · [Testing](docs/testing.md)
- [Reporting a bug](docs/reporting-bugs.md)
- [Changelog](CHANGELOG.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

**Found a bug?** See [how to report a bug](docs/reporting-bugs.md) — a person or an
AI coding agent can file one straight from the terminal with `gh`.

## Security

See [SECURITY.md](SECURITY.md) for how to report vulnerabilities.

## License

[Apache-2.0](LICENSE)
