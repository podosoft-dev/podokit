# Updating a generated project

PodoKit v1 updates Bun/Elysia v1 projects. It does not convert PodoKit 0.x
Node/NestJS projects in place.

## Project metadata

Every generated project commits:

- `.podokit/manifest.json` — PodoKit version, template, Bun toolchain, modules,
  and rendering answers.
- `.podokit/files.lock` — ownership tier and generated hash for every tracked
  file.

| Tier | Meaning | Example |
|---|---|---|
| managed | PodoKit owns the file and updates it safely | `apps/api/src/main.ts` |
| assembled | PodoKit rebuilds fenced registrations from the module set | `apps/api/src/app.ts`, `auth/auth.ts` |
| owned | Application code; PodoKit never overwrites it | routes, UI primitives, `app.extensions.ts` |

## Inspect before updating

```bash
podo status
podo diff
podo doctor
podo update
```

Runtime providers have their own dry-run-first command and remain part of the
same managed manifest and lockfile:

```bash
podo provider list
podo provider set object-storage local
podo provider set object-storage local --apply
```

The apply step updates code and configuration and may add an implementation
module. It does not migrate or delete database rows, cache entries, queued jobs,
or stored objects. Follow the backup and data-migration boundary in
[Runtime providers](providers.md).

`podo update` is read-only. It rebuilds the current v1 template and modules in
memory and prints a per-file plan. `podo doctor` checks declared Elysia, Svelte,
and Better Auth versions against the supported ranges.

Apply only after reviewing the plan:

```bash
podo update --apply
```

During apply:

- unchanged managed files are replaced with the new generated version;
- assembled fenced regions are recomputed from the module graph;
- edited managed files use a 3-way merge when a previous template tree is
  available;
- conflicts are written with standard conflict markers and reported;
- owned files are never modified; and
- the manifest and lockfile advance only with the applied tree.

The target module graph is authoritative. If a module gains a requirement,
PodoKit applies the dependency first so services, imports, package dependencies,
environment examples, and tests arrive together.

## Bun-only v1 boundary

PodoKit v1 manifests declare Bun 1.4.0. The removed `podo runtime set` command
is not a migration mechanism. A PodoKit 0.x manifest is rejected with a message
to use the final 0.x CLI:

```bash
npx @podosoft/podokit@0.17.4 status
npx @podosoft/podokit@0.17.4 update
```

This boundary is deliberate. Automatic conversion cannot safely infer custom
NestJS decorators, guards, interceptors, TypeORM repositories, middleware,
dynamic modules, or application-specific API semantics. Create a new v1 app
and migrate domain behavior with explicit endpoint and data-contract tests.

## External package modules

Upgrade an external module with Bun, then preview and apply its managed changes:

```bash
bun update @podosoft/podokit-module-blog
podo update
podo update --apply
```

The manifest records the package name and installed version. If the package is
missing from `node_modules`, update fails instead of silently removing its
files. When a 3-way merge requires a previous external module, registry access
to that recorded version is required.

## Module path migrations

Module manifests can declare atomic path migrations. PodoKit expands directory
moves in the preview, preserves edited bytes, applies exact text replacements,
updates lock paths and ownership globs, and records the migration identifier
only after success.

The preflight refuses to proceed if a destination exists, a replacement count
does not match, or an installed external package still ships an incompatible
layout.

## Removing a module

```bash
podo remove <module>
```

Removal reverses registrations, files, package overlays, and environment
examples. It refuses to remove a module required by another installed module,
keeps locally edited files, and never drops database tables.

## Taking ownership

```bash
podo eject apps/api/src/example.ts
```

Eject changes that exact path to the owned tier. Future updates neither restore
nor overwrite it, even when it is moved or deleted. Use this only when the
application accepts responsibility for keeping the file compatible.

Modules can declare owned presentation paths and managed exceptions. This lets
public SvelteKit pages remain fully customizable while route loaders, reusable
logic, or agent workflows continue to receive safe updates.

## Extending the Elysia application

`apps/api/src/app.extensions.ts` is application-owned. Register custom services
or module descriptors there without editing assembled fences:

```ts
import type { PodokitModule, ServiceRegistry } from "./core/services";

export function configureServices(services: ServiceRegistry): void {
  // Register or override an application-owned service before startup freezes.
  void services;
}

export const extensionModules: PodokitModule[] = [];
```

For a new route, create an Elysia plugin, validate inputs with `t`, throw
`AppException` with a stable code, declare OpenAPI details, register its access
policy, and add Bun tests plus an API contract entry.

## Compatibility ranges

| Framework | Supported range |
|---|---|
| `elysia` | `^1.4` |
| `svelte` | `^5` |
| `better-auth` | `>=1.7.1 <1.8` |

`podo doctor` warns when an application moves outside these ranges.

Better Auth 1.7 adds issuer-scoped account identities and a required `issuer`
column. Fresh PodoKit v1 applications receive the complete schema through their
initial migration. For a populated Better Auth 1.6 PostgreSQL database,
`migrate:all` adds the column as nullable, backfills every safely derivable
credential and built-in social-provider identity, checks collisions, installs a
compatibility trigger for writes from the release that is still serving, and only
then adds the required constraint and compound unique index.

The migration fails closed for an unknown provider and for Microsoft accounts.
Microsoft 1.7 identities change from `sub` to the directory `oid`, which cannot be
derived safely when a verified ID token or trusted directory export is unavailable.
Complete that mapping before the upgrade as described in the
[Better Auth 1.7 upgrade guide](https://better-auth.com/docs/guides/1-7-upgrade-guide#account-identity-is-scoped-by-issuer).
