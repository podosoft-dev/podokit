# {{projectName}}

Full-stack TypeScript starter generated with [PodoKit](https://github.com/podosoft-dev/podokit).

- `apps/api` — Bun 1.4 + Elysia API: schema-validated env, `/health` + `/health/ready`, merged OpenAPI at `/api-docs`, a standard error envelope, and Bun.SQL + PostgreSQL. TypeORM is used only to execute migrations.
- `apps/web` — SvelteKit app (TailwindCSS v4, shadcn-svelte, typesafe-i18n) that talks to the API through a server-side proxy.
- `infra/` — Docker Compose (PostgreSQL, Redis) and k3s manifests.

## Getting started

### Recommended: containerized development

```bash
{{packageManager}} install
cp .env.example .env
{{packageExecutor}} @podosoft/podokit dev watch
```

Open the URL printed by the command; a new project defaults to
**http://{{projectName}}.localhost**. The committed `.podokit/dev.json` is the
source of truth if you change the hostname. The first running PodoKit project starts
one user-level Traefik gateway on `127.0.0.1:80`; additional projects reuse it and
route by that hostname. Even a single app uses
the same topology, with one route and no project-specific host port.

When the API exposes WebSocket endpoints, add their exact paths to
`.podokit/dev.json` under `webSocketPaths`. The shared gateway sends only those paths
directly to the API and leaves every other path on the web app. Add `publicUrl` to the
same file when an HTTPS tunnel preserves its public `Host` header.

Run lifecycle and container commands from a second terminal:

```bash
{{packageExecutor}} @podosoft/podokit dev url
{{packageExecutor}} @podosoft/podokit dev up -d # detached stack without source watching
{{packageExecutor}} @podosoft/podokit dev ps
{{packageExecutor}} @podosoft/podokit dev logs
{{packageExecutor}} @podosoft/podokit dev exec api {{apiRun}} migration:run
{{packageExecutor}} @podosoft/podokit dev down
```

`dev watch` reads `.podokit/manifest.json` and automatically activates `cache`,
`storage`, and `queue` when installed modules require Redis, MinIO, or a worker.
`dev up` uses the same shared gateway and module profiles without keeping Compose
Watch attached.
You can still activate an additional Compose profile explicitly:

```bash
{{packageExecutor}} @podosoft/podokit dev watch --profile dev
```

Explicit profile flags are preserved for other lifecycle commands. `dev down`
activates all profiles while removing this project's stack and route. If it is
the final registered
project, it also removes the shared gateway and network. Source changes are synced
through Compose Watch, including Vite HMR on the same portless browser origin.

### Alternative: host processes

Use this loop when you want only the web and API processes on the host:

```bash
# start local PostgreSQL + Redis
docker compose -f infra/docker/docker-compose.yml up -d

{{packageManager}} run dev
```

- API: http://localhost:5002 — health at `/health`, docs at `/api-docs`
- Web: http://localhost:5001

## Database & migrations

The API uses Bun.SQL for request-time queries and TypeORM only as a migration
runner. Add a numbered migration under `apps/api/src/migrations`, then run it:

```bash
{{apiRun}} migration:run
```

Want a worked example? Generate the `todo` template instead:
`{{packageExecutor}} @podosoft/podokit create my-app --template todo`.

For multi-project routing, container profiles, migrations, and OAuth over a
stable HTTPS tunnel, see the PodoKit [development guide](https://github.com/podosoft-dev/podokit/blob/main/docs/development.md).

## Deploy

Docker Compose lives in `infra/docker`; the basic k3s manifests in `infra/k3s`
route every public path through the web proxy. For a managed release on an
existing cluster, initialize an application-owned profile:

```bash
{{packageExecutor}} @podosoft/podokit deploy init --profile production --context production --host app.example.com
{{packageExecutor}} @podosoft/podokit deploy doctor --profile production
{{packageExecutor}} @podosoft/podokit deploy plan --profile production --release v1.2.3
```

Use existing Kubernetes Secrets and never commit their values. See the PodoKit
[deployment guide](https://github.com/podosoft-dev/podokit/blob/main/docs/deployment.md).

Build production images from the workspace root so Docker can use the committed
lockfile and all workspace package manifests:

```bash
docker build -f apps/api/Dockerfile -t {{projectName}}-api .
docker build -f apps/web/Dockerfile -t {{projectName}}-web .
```

The generated Kubernetes deployment trusts the ingress-provided
`x-forwarded-proto` and `x-forwarded-host` headers so the web server can enforce
same-origin form submissions. If the web container is served directly over plain
HTTP, fix its public origin at build time instead:

```bash
docker build --build-arg PODOKIT_BUILD_ORIGIN=https://example.com -f apps/web/Dockerfile -t {{projectName}}-web .
```

For a Docker Compose deployment behind a trusted reverse proxy, set
`PROTOCOL_HEADER=x-forwarded-proto` and `HOST_HEADER=x-forwarded-host` in the
deployment profile runtime configuration and list the proxy's direct CIDR blocks in
`exposure.trustedProxyCidrs`. Never trust client-controlled forwarded headers on a
directly exposed container.

If the production API exposes WebSocket endpoints, list their exact paths under
`exposure.webSocketPaths` in the deployment profile. The Compose driver then keeps a
single published port, sends only those paths to API, and sends all other traffic to
web. The external TLS proxy continues to use the same single upstream. Keep
`trustedProxyCidrs` empty unless that upstream is a known reverse proxy.
