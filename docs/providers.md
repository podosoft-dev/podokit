# Runtime providers

PodoKit keeps application features behind stable database, cache, object
storage, event, and job contracts. A generated project records one active
implementation for each capability in `.podokit/manifest.json` and the managed
`apps/api/src/config/providers.ts` source.

| Capability | Distributed/server provider | Local provider |
| --- | --- | --- |
| Database | `postgres` | `sqlite` |
| Cache and rate limits | `redis` | `memory` |
| Object storage | `s3` | `local` |
| Events | `redis` | `memory` |
| Jobs | `bullmq` | `local` |

Distributed providers support multiple API or worker processes. Memory events,
memory cache, local jobs, and local object storage are designed for one API
process. The deployment planner enforces one API replica when any selected
provider has that constraint and omits unneeded managed dependencies.

## Create with SQLite

Database selection is available during generation:

```bash
podo create my-app --database sqlite
```

This selects SQLite while retaining the server defaults for other capabilities.
Select a complete local profile explicitly when building a desktop or
single-process application:

```bash
cd my-app
podo provider set cache memory --apply
podo provider set object-storage local --apply
podo provider set events memory --apply
podo provider set jobs local --apply
```

Each command installs the selected implementation module when it is missing.
Feature modules depend on capabilities instead of concrete infrastructure, so
`podo add file-upload`, `podo add rate-limit`, `podo add sse`, and `podo add
job-progress` compose with the active provider set.

## Inspect and switch an existing project

```bash
podo provider list
podo provider set database sqlite
podo provider set database sqlite --apply
```

`provider set` is a dry run unless `--apply` is present. It previews the source,
manifest, lockfile, and implementation modules it would add. PodoKit refuses to
replace a locally edited provider source; resolve the edit or take ownership with
`podo eject` before changing the selection.

Provider switching changes configuration and code only. It never copies,
transforms, or deletes existing database rows, Redis keys, queued jobs, or
objects. Back up both sides, perform the data migration with a tool appropriate
to those systems, update runtime environment values such as `DATABASE_URL` and
`LOCAL_STORAGE_PATH`, run `migrate:all`, and verify the application before
retiring the previous service.

The previous provider module remains installed but inactive, which makes a
configuration rollback possible. After the new provider and data have been
verified, `podo remove <old-provider-module>` can remove unused code and package
dependencies. Removal still preserves locally edited files and never deletes
provider data.

## Runtime contracts

`@podosoft/podokit-runtime` exports stable service keys and TypeScript contracts:

- `DATABASE` / `DatabaseProvider`
- `CACHE` / `CacheStore`
- `OBJECT_STORAGE` / `ObjectStore`
- `EVENTS` / `EventBus`
- `JOBS` / `JobQueue`

Feature modules resolve these keys from the generated service registry. Provider
modules are the only layer that should import Redis, S3, BullMQ, or local storage
implementation details. Application-owned replacements can use the same
contracts through `apps/api/src/app.extensions.ts`.

## Local persistence and backup

SQLite defaults to `./data/podokit.sqlite`; local object storage defaults to
`./data/files`. Set absolute paths for packaged desktop and production use.
SQLite enables WAL, foreign keys, and a busy timeout. Back up the database and
local files as one logical snapshot, and include the authentication secret used
to decrypt stored configuration. In-process cache and event state is ephemeral;
the local job queue persists its records in the selected database.
