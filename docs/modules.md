# Modules (`podo add`)

Add composable features to an existing generated project without duplicating a
whole template. Run inside a project created by `podo create`:

```bash
cd my-app
npx @podosoft/podokit add <module>
```

`podo add` (with no module) lists what's available. Modules can depend on other modules — required modules are added automatically. Each module:

- overlays its files into the project,
- merges its dependencies into the target app's `package.json`,
- appends any environment variables to `.env.example`,
- wires itself into `app.module.ts` at marker comments, and
- prints follow-up steps.

## Available modules

### `auth` (better-auth)

Full authentication built on [better-auth](https://better-auth.com): email/password
and sessions out of the box, plus **OAuth** and **2FA** enabled by configuration.
Adding it installs a **global auth guard**, so the API is **secure by default** —
every route requires a session except `/health` and `/api/auth/*`. Opt routes out
with `@Public()`; read the current user with `@Session()`.

```bash
npx @podosoft/podokit add auth
npm install
# create the auth tables (user/session/account/verification)
npx @better-auth/cli migrate -y --config apps/api/src/auth/auth.ts
npm run dev

# sign up (sets a session cookie), then call a protected route
curl -c cookies.txt -XPOST localhost:3000/api/auth/sign-up/email \
  -H 'content-type: application/json' -d '{"email":"a@example.com","password":"password123","name":"A"}'
curl -b cookies.txt localhost:3000/account/me
```

- **Secure by default**: all module endpoints (jobs, storage, files, cache, …) are protected once `auth` is added.
- **OAuth**: set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` or `GITHUB_*` in `.env` to enable a provider.
- **2FA (TOTP)**: set `AUTH_TWO_FACTOR=true`.
- Security/audit modules build on this (they require `auth`).


### `bullmq`

Background jobs with [BullMQ](https://docs.bullmq.io): a demo queue, enqueue/
status endpoints on the API, and a **separate worker process** that consumes
jobs (the standard production shape — workers scale independently of the API).
Needs Redis.

```bash
npx @podosoft/podokit add bullmq
npm install
docker compose -f infra/docker/docker-compose.yml up -d   # postgres + redis

# terminal 1 — API (producer)
npm run dev
# terminal 2 — worker (consumer)
npm run dev:worker -w my-app-api

curl -XPOST localhost:3000/jobs -H 'content-type: application/json' -d '{"text":"hello"}'
curl localhost:3000/jobs/<id>   # waiting -> active -> completed
```

Without the worker running, jobs stay `waiting`; start the worker and they complete.

**Deployment.** The worker is a separate process, so `podo add bullmq` also adds:

- `infra/k3s/worker-deployment.yaml` — runs the API image with `node dist/main-worker` (no Service/Ingress).
- `infra/docker/worker.compose.example.yml` — an example worker service for a containerized Compose deployment.

Run it in production as `npm run start:worker` (or the container command `node dist/main-worker`).

### `object-storage-s3`

S3-compatible object storage that works with **both AWS S3 and MinIO**, selected
by the `STORAGE_PROVIDER` env var (`minio` or `aws`). Provides a `StorageService`
(put/get/delete + presigned URLs) and demo `/storage` endpoints.

```bash
npx @podosoft/podokit add object-storage-s3
npm install

# local dev with MinIO
docker compose -f infra/docker/docker-compose.yml -f infra/docker/minio.compose.yml up -d
npm run dev

curl -XPUT localhost:3000/storage/hello -H 'content-type: application/json' -d '{"content":"hi"}'
curl localhost:3000/storage/hello            # { key, content }
curl localhost:3000/storage/hello/presigned  # { url }
```

**Providers** (set in `.env`):

- **MinIO** (default, for dev): `STORAGE_PROVIDER=minio`, `S3_ENDPOINT=http://localhost:9000`, `S3_FORCE_PATH_STYLE=true`, `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`.
- **AWS S3**: `STORAGE_PROVIDER=aws`, remove `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE=false`, real credentials, and a pre-created bucket/region.

The same `@aws-sdk/client-s3` code path serves both — only configuration differs.

### `file-upload`

A multipart upload endpoint that stores files via object storage and returns a
presigned download URL. Depends on `object-storage-s3` — `podo add file-upload`
adds it automatically if it is not already present.

```bash
npx @podosoft/podokit add file-upload   # also adds object-storage-s3
npm install
docker compose -f infra/docker/docker-compose.yml -f infra/docker/minio.compose.yml up -d
npm run dev

curl -F 'file=@./photo.png' localhost:3000/files
# → { key, url }  (url is a presigned download link)
```

### `sse`

Server-Sent Events for real-time updates: a `/events/stream` endpoint (heartbeat
plus published messages) and a `POST /events` publisher. `EventsService` is
global, so any module (for example a queue processor) can broadcast updates.

```bash
npx @podosoft/podokit add sse
npm run dev

# terminal 1 — stream
curl -N localhost:3000/events/stream
# terminal 2 — publish
curl -XPOST localhost:3000/events -H 'content-type: application/json' -d '{"message":"hello"}'
```

Pairs well with `bullmq` — inject `EventsService` into the worker to stream job progress.

### `redis`

A Redis client ([ioredis](https://github.com/redis/ioredis)) with `get`/`set`/`del`
and `publish`/`subscribe`, exposed as a global `RedisService`, plus demo `/cache`
endpoints.

```bash
npx @podosoft/podokit add redis
npm install
docker compose -f infra/docker/docker-compose.yml up -d   # redis
npm run dev

curl -XPUT localhost:3000/cache/greeting -H 'content-type: application/json' -d '{"value":"hi","ttl":60}'
curl localhost:3000/cache/greeting   # { key, value }
```

### `job-progress`

Live job progress streaming — a capstone that composes `bullmq` + `redis` + `sse`
(all auto-added). A **worker** processes a job and reports progress over a Redis
channel; the **API** subscribes and relays it to SSE clients. This is the
production pattern for pushing worker progress to the browser across processes.

```bash
npx @podosoft/podokit add job-progress   # also adds bullmq, sse, redis
npm install
docker compose -f infra/docker/docker-compose.yml up -d   # postgres + redis

npm run dev                          # terminal 1 — API
npm run dev:worker -w my-app-api     # terminal 2 — worker

curl -N localhost:3000/events/stream                                             # terminal 3 — watch
curl -XPOST localhost:3000/progress -H 'content-type: application/json' -d '{"steps":5}'
# the stream shows job-progress events: 20 -> 40 -> 60 -> 80 -> 100
```

### `logging`

Structured request logging with [nestjs-pino](https://github.com/iamolegga/nestjs-pino):
every HTTP request is logged with a per-request **correlation id** (`x-request-id`,
honored from the inbound header and echoed back). Pretty single-line logs in dev,
JSON in production.

```bash
npx @podosoft/podokit add logging
npm install
npm run dev
curl localhost:3000/health   # watch the API log a structured "request completed" line
```

Set `LOG_LEVEL` (`debug|info|warn|error`) in `.env`. To route Nest's own logs
through pino as well, create the app with `{ bufferLogs: true }` and call
`app.useLogger(app.get(Logger))` in `main.ts`.

## Roadmap

More modules are planned — redis, queue (BullMQ), object storage (S3), file
upload, rate limiting, SSE — so you can grow a project feature by feature. See
the repository roadmap for status.
