# Examples

PodoKit generates projects rather than vendoring large example apps, so the
canonical example is what `podo create` produces. Each example below layers on
one more feature.

## 1. todo (`--template todo`)

The `todo` template is a working todo app: a SvelteKit UI, a NestJS `todos`
CRUD API (TypeORM + PostgreSQL), and Swagger docs. (The default
`fullstack-nest-svelte` template is the same foundation without the todo code.)

| Web (SvelteKit) | API docs (Swagger) |
| --- | --- |
| ![Generated todo app](../docs/images/todo-app.png) | ![Generated API docs](../docs/images/api-docs.png) |

```bash
npx @podosoft/podokit create todo-app --template todo
cd todo-app
npm install
cp .env.example .env

# start PostgreSQL + Redis, then apply migrations
docker compose -f infra/docker/docker-compose.yml up -d
npm run migration:run -w todo-app-api

npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:3000 — health at `/health`, docs at `/api-docs`

Try it: add a todo in the UI, then open `/api-docs` and call `GET /todos`.

For a minimal, dependency-light layout instead, use `--template base`.

## 2. auth (`podo add auth-jwt`)

Add JWT authentication to any generated project — register, login, a JWT guard,
and a protected `/auth/me` route (TypeORM `users` table).

```bash
npx @podosoft/podokit create auth-demo
cd auth-demo && npm install && cp .env.example .env
npx @podosoft/podokit add auth-jwt
npm install
docker compose -f infra/docker/docker-compose.yml up -d
npm run migration:run -w auth-demo-api
npm run dev

# register → returns a JWT, then call the protected route
curl -XPOST localhost:3000/auth/register -H 'content-type: application/json' \
  -d '{"email":"a@example.com","password":"password123"}'
curl localhost:3000/auth/me -H 'authorization: Bearer <token>'
```

## 3. background jobs (`podo add bullmq`)

Add a BullMQ queue with a **separate worker process**.

```bash
npx @podosoft/podokit create jobs-demo
cd jobs-demo && npm install && cp .env.example .env
npx @podosoft/podokit add bullmq
npm install
docker compose -f infra/docker/docker-compose.yml up -d

# API (producer) and worker (consumer) run as separate processes
npm run dev                       # terminal 1
npm run dev:worker -w jobs-demo-api   # terminal 2

curl -XPOST localhost:3000/jobs -H 'content-type: application/json' -d '{"text":"hello"}'
curl localhost:3000/jobs/<id>     # waiting -> active -> completed
```

Deploy the worker separately (k3s `worker-deployment.yaml` and a Compose worker example are added by the module).

## 4. file uploads (`podo add file-upload`)

Upload files to S3-compatible storage (MinIO in dev, AWS S3 in prod) and get a
presigned download URL. `file-upload` pulls in `object-storage-s3` automatically.

```bash
npx @podosoft/podokit create files-demo
cd files-demo && npm install && cp .env.example .env
npx @podosoft/podokit add file-upload
npm install
docker compose -f infra/docker/docker-compose.yml -f infra/docker/minio.compose.yml up -d
npm run dev

curl -F 'file=@./photo.png' localhost:3000/files   # → { key, url }
```

## 5. job dashboard — live progress (`podo add job-progress`)

Stream a background job's progress to the browser. `job-progress` composes
`bullmq` (queue + worker), `redis` (pub/sub bridge), and `sse` (stream) — all
added automatically.

```bash
npx @podosoft/podokit create jobs-dash
cd jobs-dash && npm install && cp .env.example .env
npx @podosoft/podokit add job-progress          # also adds bullmq, sse, redis
npm install
docker compose -f infra/docker/docker-compose.yml up -d

npm run dev                            # API
npm run dev:worker -w jobs-dash-api    # worker (separate process)

curl -N localhost:3000/events/stream   # watch
curl -XPOST localhost:3000/progress -H 'content-type: application/json' -d '{"steps":5}'
# stream: job-progress 20 -> 40 -> 60 -> 80 -> 100 (pushed from the worker via Redis)
```

## Roadmap

Further examples grow feature by feature (auth-guarded todos, file uploads,
background jobs with a queue, streaming, …) as the corresponding `podo add`
modules land. See the repository roadmap for status.
