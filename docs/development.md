# Local development

How to work on PodoKit itself — templates, modules, and the packages — and
verify changes in a real generated app **without publishing to npm**.

## Why this is needed

The `fullstack-nest-svelte` and `todo` templates depend on
`@podosoft/podokit-api-client`. Until that package is published, a freshly
generated app cannot `npm install` it from the registry. For local work we
point the generated app at the **local** package instead.

## One command

```bash
# from the monorepo root
node scripts/dev-app.mjs /tmp/myapp                      # fullstack, no modules
node scripts/dev-app.mjs /tmp/myapp --add auth,admin-dashboard
node scripts/dev-app.mjs /tmp/myapp --template todo --no-build
```

`scripts/dev-app.mjs`:
1. builds the monorepo (skip with `--no-build`),
2. generates the app with the local CLI,
3. rewrites the web app's `@podosoft/podokit-api-client` dependency to
   `file:<repo>/packages/api-client` (re-packed on every install),
4. applies any `--add` modules,
5. runs `npm install`.

## Iterating on the api-client

After editing `packages/api-client`:

```bash
npm run build -w @podosoft/podokit-api-client   # in the monorepo
# then, in the generated app:
npm install                                     # picks up the new local build
```

## Running the generated app

```bash
cd /tmp/myapp
docker compose -f infra/docker/docker-compose.yml up -d      # postgres (+ redis)
# if the app uses the auth module, create the auth tables:
npx @better-auth/cli migrate -y --config apps/api/src/auth/auth.ts
npm run dev                    # API + web
```

## Verifying template / module changes

The fastest signal without running servers:

```bash
node scripts/dev-app.mjs /tmp/myapp --add <module>
cd /tmp/myapp
npm run build -w myapp-api        # NestJS build
npm run build -w myapp-web        # SvelteKit build
cd apps/web && npx svelte-kit sync && npx svelte-check --tsconfig ./tsconfig.json
```

For anything auth/session related (login, admin, cookies), do a full local run
(compose + migrate + `npm run dev`) and exercise the flow in the browser — a
build passing is necessary but not sufficient.
