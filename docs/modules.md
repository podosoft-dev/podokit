# Modules (`podo add`)

Add composable features to an existing generated project without duplicating a
whole template. Run inside a project created by `podo create`:

```bash
cd my-app
npx @podosoft/podokit add <module>
```

`podo add` (with no module) lists what's available. Each module:

- overlays its files into the project,
- merges its dependencies into the target app's `package.json`,
- appends any environment variables to `.env.example`,
- wires itself into `app.module.ts` at marker comments, and
- prints follow-up steps.

## Available modules

### `auth-jwt`

JWT authentication for the NestJS API: register, login, a JWT guard, and a
protected `/auth/me` route backed by a TypeORM `users` table.

```bash
npx @podosoft/podokit add auth-jwt
npm install
npm run migration:run -w my-app-api

# then
curl -XPOST localhost:3000/auth/register -H 'content-type: application/json' \
  -d '{"email":"a@example.com","password":"password123"}'
# → { accessToken, user }
curl localhost:3000/auth/me -H 'authorization: Bearer <token>'
```

Set a real `JWT_SECRET` in `.env` before deploying.

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

## Roadmap

More modules are planned — redis, queue (BullMQ), object storage (S3), file
upload, rate limiting, SSE — so you can grow a project feature by feature. See
the repository roadmap for status.
