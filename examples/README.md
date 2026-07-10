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

- Web: http://localhost:5001
- API: http://localhost:5002 — health at `/health`, docs at `/api-docs`

Try it: add a todo in the UI, then open `/api-docs` and call `GET /todos`.

For a minimal, dependency-light layout instead, use `--template base`.

## 2. auth (`podo add auth`)

Add full authentication (better-auth): email/password + sessions, with OAuth and
2FA available by config. Adding it makes the API **secure by default** — every
route needs a session except `/health` and `/api/auth/*`.

```bash
npx @podosoft/podokit create auth-demo
cd auth-demo && npm install && cp .env.example .env
npx @podosoft/podokit add auth
npm install
docker compose -f infra/docker/docker-compose.yml up -d
npx @better-auth/cli migrate -y --config apps/api/src/auth/auth.ts
npm run dev

# sign up (sets a session cookie), then call a protected route
curl -c cookies.txt -XPOST localhost:5002/api/auth/sign-up/email \
  -H 'content-type: application/json' -d '{"email":"a@example.com","password":"password123","name":"A"}'
curl -b cookies.txt localhost:5002/account/me
```

Enable OAuth by setting a provider's `*_CLIENT_ID`/`*_CLIENT_SECRET`, and 2FA with `AUTH_TWO_FACTOR=true`.

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

curl -XPOST localhost:5002/jobs -H 'content-type: application/json' -d '{"text":"hello"}'
curl localhost:5002/jobs/<id>     # waiting -> active -> completed
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

curl -F 'file=@./photo.png' localhost:5002/files   # → { key, url }
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

curl -N localhost:5002/events/stream   # watch
curl -XPOST localhost:5002/progress -H 'content-type: application/json' -d '{"steps":5}'
# stream: job-progress 20 -> 40 -> 60 -> 80 -> 100 (pushed from the worker via Redis)
```

## 6. admin dashboard (`podo add admin-dashboard`)

A full admin console on top of `auth`: login/signup/password-reset pages and a
shadcn-svelte sidebar shell, plus:

- **User & session management** — list, filter, search, ban/unban, set role,
  revoke sessions, create/delete users.
- **Audit log** — security-relevant actions (sign-ups, admin changes) recorded
  and browsable at `/admin/audit`.
- **Organizations** — teams with members and invitations.
- **Runtime Settings** — enable/disable sign-in methods and configure OAuth
  providers, SMTP, and server toggles (email verification, breached-password
  check, self-delete, audit log) from `/admin/settings`. These are stored
  **encrypted in the DB and applied live — no restart**, with env vars as an
  optional fallback.
- **Account** self-service — password, 2FA, passkeys, API keys, sessions.

| Users | Audit log | Settings — social login |
| --- | --- | --- |
| ![Admin users](../docs/images/admin-users.png) | ![Audit log](../docs/images/admin-audit.png) | ![Settings — social login](../docs/images/admin-settings-social.png) |

```bash
npx @podosoft/podokit create my-admin
cd my-admin && npm install && cp .env.example .env
npx @podosoft/podokit add admin-dashboard    # also adds auth
npm install
docker compose -f infra/docker/docker-compose.yml up -d
npx @better-auth/cli migrate -y --config apps/api/src/auth/auth.ts
npm run migration:run -w my-admin-api        # creates auth_config + app_setting
# set ADMIN_EMAILS=you@example.com in .env
npm run dev
# open /signup, register that email (→ admin), then manage users at /admin/users
```

## Keeping examples up to date

These are generated apps, so they ship with the `.podokit/` lockfile and can
receive template and module improvements via `podo update`. See
[../docs/updating.md](../docs/updating.md).
