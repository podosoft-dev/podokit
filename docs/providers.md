# Runtime providers

PodoKit keeps application features behind stable database, cache, object
storage, event, and job contracts. A generated project records one active
implementation for each capability in `.podokit/manifest.json` and the managed
`apps/api/src/config/providers.ts` source.

## Choices and defaults

| Capability | Default | Local alternative | Implementation modules |
| --- | --- | --- | --- |
| `database` | `postgres` — PostgreSQL | `sqlite` — embedded database file | Included in `fullstack` and `todo` |
| `cache` | `redis` — shared Redis cache | `memory` — bounded in-process cache | `redis` / `cache-memory` |
| `object-storage` | `s3` — S3-compatible object service | `local` — local filesystem | `object-storage-s3` / `object-storage-local` |
| `events` | `redis` — shared Redis events | `memory` — in-process events | `events-redis` / `events-memory` |
| `jobs` | `bullmq` — Redis queue and separate worker | `local` — database-persistent embedded worker | `bullmq` / `jobs-local` |

For a simple program, prototype, desktop application, or single-process
service, SQLite, memory cache/events, local files, and local jobs avoid running
external PostgreSQL, Redis, and S3 services. Template and provider choices are
independent: use `fullstack` or `todo` with local providers for a lightweight
working app. `base` is a minimal skeleton without the database/module foundation.

Selections can be mixed, for example PostgreSQL with memory cache and local
files. Creation records the choices but does not install all optional modules
or start infrastructure. `provider set --apply` installs its implementation;
feature modules install the implementations of their required capabilities.

Server providers supply shared infrastructure. Memory events,
memory cache, local jobs, and local object storage are designed for one API
process. The deployment planner enforces one API replica when any selected
provider has that constraint and omits unneeded managed dependencies.

## Select providers when creating a project

Only database selection is available as a creation flag. PostgreSQL is the
default; select SQLite explicitly:

```bash
podo create my-app --database sqlite
```

This selects SQLite while retaining Redis cache, S3, Redis events, and BullMQ.
There are no `--cache` or `--storage` creation flags. Configure those providers
after creation. Select the complete local combination before adding features:

```bash
cd my-app
podo provider set cache memory --apply
podo provider set object-storage local --apply
podo provider set events memory --apply
podo provider set jobs local --apply
```

Then run `bun install`, copy `.env.example` to `.env`, and run
`bun run --cwd apps/api migration:run`. Use host API/web processes to avoid
Docker; the containerized `podo dev watch` workflow still needs it. A full
copyable example is in
[Getting Started](getting-started.md#small-app-with-local-providers).

Each command installs the selected implementation module when it is missing.
Feature modules depend on capabilities instead of concrete infrastructure, so
`podo add file-upload`, `podo add rate-limit`, `podo add sse`, and `podo add
job-progress` compose with the active provider set.

Configure providers before adding features so the CLI installs the intended
dependencies. For example, `file-upload` uses `object-storage-local` when storage
is `local`, and `job-progress` uses `jobs-local`, `events-memory`, and `sse` for
the local combination. Provider commands and `podo add` append settings to
`.env.example`; merge new settings into an existing `.env` yourself.

## Runtime settings

| Provider | Setting | Default behavior |
| --- | --- | --- |
| PostgreSQL | `DATABASE_URL`, or `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Example connects to `localhost:5432`, database/user `podokit`; `DATABASE_URL` takes precedence |
| SQLite | `DATABASE_URL` with a `sqlite:` or `file:` URL | `./data/podokit.sqlite` |
| Redis cache/events | `REDIS_URL`, or `REDIS_HOST`, `REDIS_PORT`, `REDIS_DB`, and optional auth/TLS settings | `localhost:6379`, database `0`; `REDIS_URL` takes precedence |
| Memory cache/events | No external connection | Bounded state held inside the API process |
| S3 | `STORAGE_PROVIDER`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, credentials, `S3_FORCE_PATH_STYLE` | Silo-compatible development settings described below |
| Local files | `LOCAL_STORAGE_PATH` | `./data/files` |
| Local jobs | Selected database and `LOCAL_JOBS_POLL_INTERVAL_MS` | Embedded API worker; polling every `250` ms |

The provider configuration selects the implementation; environment settings
configure its connection or paths. Setting `DATABASE_URL` alone does not change
the recorded database provider.

### S3-compatible storage

`object-storage=s3` supports AWS S3 and Silo/MinIO-compatible services through
the same storage contract. The module's development defaults are:

```dotenv
STORAGE_PROVIDER=minio
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=podokit
S3_FORCE_PATH_STYLE=true
```

The local Compose overlay uses Silo. The `minio` provider value and Compose names
are retained for compatibility. For AWS S3, set `STORAGE_PROVIDER=aws`, remove
`S3_ENDPOINT`, set `S3_FORCE_PATH_STYLE=false`, and provide your bucket, region,
and credentials. See [Object storage modules](modules.md#object-storage-s3).

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
`./data/files`, both relative to the API process's working directory. Commands
using `bun run --cwd apps/api` therefore use `apps/api/data` by default. Set
absolute paths for packaged desktop and production use, and use the same
database path for migrations and the API.
SQLite enables WAL, foreign keys, and a busy timeout. Back up the database and
local files as one logical snapshot, and include the authentication secret used
to decrypt stored configuration. In-process cache and event state is ephemeral;
the local job queue persists its records in the selected database.
