# Templates

`podo create --template <name>` selects what gets scaffolded.

## `fullstack-nest-svelte` (default)

A full-stack npm workspace.

```
apps/
  api/                 # NestJS
    src/
      main.ts          # global ValidationPipe + exception filter, CORS
      app.module.ts
      config/          # typed environment validation
      health/          # GET /health (liveness)
      common/          # AppException + standard error envelope
    Dockerfile
  web/                 # SvelteKit (adapter-node)
    src/
      routes/          # (+layout, +page, api/ server proxy)
      lib/server/      # backend-proxy: header allowlist to the API
      lib/i18n/        # typesafe-i18n scaffold (en, ko)
      app.css          # TailwindCSS v4 (@import "tailwindcss")
    components.json    # shadcn-svelte config (new-york / zinc)
    Dockerfile
infra/
  docker/docker-compose.yml   # PostgreSQL + Redis (healthchecks)
  k3s/                        # namespace, deployments, service, ingress, secret example
.env.example
package.json                  # npm workspace
```

Conventions baked in:

- **Backend** returns a stable error envelope `{ success: false, error: { code, message, statusCode, path, timestamp } }`; clients branch on `code`, not the message.
- **Frontend** talks to the API only through a server-side proxy (`src/lib/server/backend-proxy.ts`) that forwards an allowlist of headers, so tokens never reach the browser.
- **Env** uses `SCREAMING_SNAKE` names grouped by service; the API validates them before listening.

## `base`

A minimal npm workspace (root `package.json`, `apps/api` and `apps/web` placeholders, `.env.example`, `.gitignore`). Use it when you want to assemble a project yourself.

## The `dot-` convention

Template files named `dot-<name>` are written as `.<name>` (for example `dot-gitignore` → `.gitignore`). This lets templates ship dotfiles that package managers would otherwise strip.

## Roadmap

Optional, composable modules (`podo add <module>`) — for example PostgreSQL/ORM, Redis, queue+worker, auth, and object storage — are planned so you can grow a project feature by feature. See the repository roadmap for status.
