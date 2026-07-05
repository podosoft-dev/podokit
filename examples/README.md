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

## Roadmap

Further examples grow feature by feature (auth-guarded todos, file uploads,
background jobs with a queue, streaming, …) as the corresponding `podo add`
modules land. See the repository roadmap for status.
