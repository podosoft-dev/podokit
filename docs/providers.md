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

### PostgreSQL connection pools

The API queries PostgreSQL through one Bun SQL pool. The auth module keeps a
second, `pg` pool for Better Auth. Both read these settings:

| Setting | Default | Effect |
| --- | --- | --- |
| `DB_POOL_MAX` | `20` | Maximum connections in the Bun SQL pool. |
| `DB_AUTH_POOL_MAX` | `10` | Maximum connections in the auth module's pool. |
| `DB_CONNECT_TIMEOUT_MS` | `10000` | How long opening a connection may take. For the auth pool it also bounds the wait for a free connection when the pool is full. |
| `DB_IDLE_TIMEOUT_MS` | `30000` | How long an unused connection stays open. `0` keeps it open. |
| `DB_QUERY_TIMEOUT_MS` | `10000` | How long a query on the Bun SQL pool may stay pending before the API checks whether PostgreSQL still answers. See below. |

Each API replica can hold `DB_POOL_MAX + DB_AUTH_POOL_MAX` connections, 30 with
the defaults. Multiply that by the API replica count, add a few connections for
the migration job and for administration, and keep the total below the server's
`max_connections`. PostgreSQL defaults to 100, so three replicas with the
defaults already use 90. Lower the pool sizes, raise `max_connections`, or put a
connection pooler such as PgBouncer in front before adding replicas.

Bun SQL queues a query while every connection is busy and does not time out that
wait. While the pool stays full, the readiness check reports the database as down
once `READINESS_CHECK_TIMEOUT_MS` passes. The API answers `503` with the
`DATABASE_UNAVAILABLE` error code and `Retry-After: 1` instead of `500` when
either pool times out opening a connection, when the auth pool has no free
connection in time, and when Bun SQL cannot reach the server or loses the
connection. Better Auth reports a failed query as a bare `500`, so when one of
its endpoints under `/api/auth`, or the session lookup of a protected route,
fails with a server error, the auth module runs `SELECT 1` on its pool and
answers `DATABASE_UNAVAILABLE` when that does not succeed within
`READINESS_CHECK_TIMEOUT_MS`. Other `500` errors stay `500`.

A server that keeps its connections open but stops answering, such as a paused
container, a frozen VM, or a network partition, leaves queries waiting without an
error. Bun SQL has no query timeout and cannot close a single pool connection, so
the API watches every query and transaction on the Bun SQL pool. When one is
still pending after `DB_QUERY_TIMEOUT_MS`, the API checks whether PostgreSQL
answers `SELECT 1` on a new connection within `READINESS_CHECK_TIMEOUT_MS`. If it
does not, the API opens a new pool and closes the old one, which fails every query
still waiting on it. Those requests answer `503` with `DATABASE_UNAVAILABLE`
about `DB_QUERY_TIMEOUT_MS` plus `READINESS_CHECK_TIMEOUT_MS` after they started,
and the API logs `Dependency connection failed; retrying in the background`.
While the server stays silent, a query on the new pool waits at most
`DB_CONNECT_TIMEOUT_MS` for its connection. Once PostgreSQL answers again,
queries succeed without a restart and the API logs `Dependency connection
restored`. A query that is only slow, on a server that still answers, keeps
running. A write that was waiting when its pool closed may still be applied if
the server resumes.

None of these settings is a statement timeout, so a long migration is not cut
short. Application migrations open their own TypeORM connection and ignore them.

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
- `RATE_LIMIT_ROUTES` / `RateLimitRouteRegistry`, registered by the `rate-limit`
  module (see [Route profiles](modules.md#route-profiles))

Feature modules resolve these keys from the generated service registry. Provider
modules are the only layer that should import Redis, S3, BullMQ, or local storage
implementation details. Application-owned replacements can use the same
contracts through `apps/api/src/app.extensions.ts`.

### Object storage reads

`ObjectStore.get(key)` streams instead of buffering. It resolves `null` for a
missing key; otherwise it returns `size`, `contentType`, `etag`, and
`lastModified` with a `ReadableStream` body that opens on the first read. Read
the body to the end or cancel it. `stat(key)` returns the same metadata without
a body. Provider errors, such as an unreachable bucket, are thrown rather than
reported as a missing object.

The S3 provider asks for the metadata first and starts the download only when
the body is read, because a missing key would otherwise surface only after a
response had started. The download is a presigned GET paced by the reader,
because Bun's `S3File.stream()` reads ahead without backpressure and would hold
the rest of the object in memory for a slow client. The GET carries `If-Match`,
so an object overwritten after its metadata was read fails the stream instead of
mixing two versions. The local provider derives the entity tag from the file's
inode, size, and modification time, and fails the stream rather than send a file
that was replaced after its metadata was read.

Serve objects with `objectResponse(request, object, options)` from the runtime
package. It sets `content-type`, `content-length`, `etag`, and `last-modified`,
answers a matching `If-None-Match` with `304` without reading the content, and
accepts a `cacheControl` value and extra headers. Use
`readObjectBytes(store, key, { maxBytes })` only for small objects you must hold
in memory.

`list(prefix, { cursor, limit })` returns one page of keys that start with
`prefix`, in ascending order, and a `nextCursor` while more keys follow. A page
holds at most `limit` keys (1 to 1000, default 1000); pass `nextCursor` back as
`cursor` for the next page. Neither provider collects the whole bucket or tree:
S3 pages with continuation tokens, and the local provider reads one directory at
a time, skipping directories that sort before the cursor. Treat cursors as
opaque and provider-specific.

### Object storage writes

`ObjectStore.put(key, body)` accepts bytes, a string, a `Blob` (including a
Bun file), a `ReadableStream<Uint8Array>` such as a request body, or an
`AsyncIterable<Uint8Array>`, and neither provider collects a streamed body into
one buffer:

- The local provider writes chunks to a temporary file next to the target and
  renames it into place.
- The S3 provider sends bytes, strings, and blobs up to 8 MiB in one request.
  Anything larger or streamed goes out as a multipart upload in 8 MiB parts,
  two in flight at a time, reusing the part buffers. Against Silo, streaming a
  200 MB body and a 1 GiB body each added about 70 MiB to the process's
  resident memory. A file-backed `Blob` is read in slices, because both Bun's
  S3 write and `Blob.stream()` would read a file into memory ahead of the
  upload.

A body that fails part way abandons the write: the temporary file is removed,
or the multipart upload is aborted, so no partial object appears.

For uploads that span several HTTP requests, such as resumable or chunked
uploads, use the multipart API on the same contract:
`createMultipartUpload(key, { contentType })`, `uploadPart(key, uploadId,
partNumber, body)`, `completeMultipartUpload(key, uploadId, parts)`, and
`abortMultipartUpload(key, uploadId)`. Parts are numbered from 1 to
`MAX_MULTIPART_PARTS` (10,000), and every part except the last needs at least
`MIN_MULTIPART_PART_BYTES` (5 MiB), the S3 rule that the local provider
enforces too, so code tested against local storage behaves the same on S3.
Failures a caller can act on throw `MultipartUploadError` with the code
`UPLOAD_NOT_FOUND`, `INVALID_PART`, or `PART_TOO_SMALL`. See the
[runtime package README](../packages/runtime/README.md#multipart-uploads) for
the full rules.

Provider details:

- **S3**: Bun's `S3Client` has no multipart calls, so the module signs these
  requests itself with AWS Signature Version 4, using the same `S3_*` (or
  `AWS_*`) credentials and endpoint settings. It works with AWS S3 and
  Silo/MinIO-compatible services. S3 needs each part's length before sending
  it, so a part passed as a stream is collected in memory first; pass a
  `Blob` or bytes when you have them, and keep parts to tens of MiB. Unfinished
  uploads keep their parts, and storage charges, until they are aborted: add a
  bucket lifecycle rule with `AbortIncompleteMultipartUpload` (for example
  after one day) on AWS. MinIO-compatible services such as Silo also expire
  stale uploads on their own schedule.
- **Local**: parts live under `LOCAL_STORAGE_PATH/.podokit/multipart/<uploadId>/`.
  Uploads idle longer than `LOCAL_STORAGE_MULTIPART_MAX_AGE` seconds (default
  86400) are removed when a later upload starts.

Bun's own request body limit still applies to each HTTP request. Raise
`API_MAX_REQUEST_BODY_SIZE` or set `apiServerOptions` (see
[API server options](templates.md#api-server-options)) when a single request must
carry more than 128 MiB, or keep requests small with multipart parts.

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
