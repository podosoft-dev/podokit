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

## Roadmap

More modules are planned — redis, queue (BullMQ), object storage (S3), file
upload, rate limiting, SSE — so you can grow a project feature by feature. See
the repository roadmap for status.
