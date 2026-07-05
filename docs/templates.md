# Templates

`podo create --template <name>` selects what gets scaffolded. Three templates ship today:

| Template | Description |
| --- | --- |
| `fullstack-nest-svelte` (default) | Clean NestJS + SvelteKit starter — no domain code |
| `todo` | The fullstack starter plus a Todo CRUD example |
| `base` | Minimal npm workspace |

## `fullstack-nest-svelte` (default)

A clean full-stack npm workspace: everything wired (config, health, Swagger, TypeORM connection, SvelteKit + Tailwind + shadcn + i18n + server proxy) but **no domain code** — you add your own entities and routes.

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

## `todo`

The `fullstack-nest-svelte` starter plus a worked **Todo** example: a `todos`
CRUD resource (TypeORM entity + versioned migration), Swagger, and a SvelteKit
todo UI wired through the server proxy. A runnable reference you can learn from
or strip down.

| Web (SvelteKit todo UI) | API docs (Swagger) |
| --- | --- |
| ![Generated todo app](images/todo-app.png) | ![Generated API docs](images/api-docs.png) |

```bash
npx @podosoft/podokit create my-app --template todo
cd my-app && npm install && cp .env.example .env
docker compose -f infra/docker/docker-compose.yml up -d
npm run migration:run -w my-app-api
npm run dev
```

## `base`

A minimal npm workspace (root `package.json`, `apps/api` and `apps/web` placeholders, `.env.example`, `.gitignore`). Use it when you want to assemble a project yourself.

## UI: shadcn-svelte

The `fullstack-nest-svelte` and `todo` templates come with [shadcn-svelte](https://shadcn-svelte.com) set up and a starter set of components **already installed** in `apps/web/src/lib/components/ui/`:

- `button`, `input`, `card`, `checkbox`, `label`

Use them directly (no raw HTML form controls needed):

```svelte
<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import * as Card from "$lib/components/ui/card";
</script>

<Card.Root>
  <Card.Header><Card.Title>Hello</Card.Title></Card.Header>
  <Card.Content class="flex gap-2">
    <Input placeholder="Name" />
    <Button>Save</Button>
  </Card.Content>
</Card.Root>
```

### Add more components

```bash
cd apps/web
npx shadcn-svelte@latest add dialog dropdown-menu badge
```

Components are copied into `src/lib/components/ui/` — they are yours to edit.

### Theming

Colors, radius, and dark-mode values are CSS variables in `apps/web/src/app.css` (`:root` for light, `.dark` for dark). Change them to restyle everything — for example a different primary color:

```css
:root { --primary: oklch(0.55 0.2 260); }   /* blue-ish */
```

Dark mode is handled by [`mode-watcher`](https://github.com/svecosystem/mode-watcher) (mounted in `+layout.svelte`); toggle with its `toggleMode()` helper. The base color palette was generated with `baseColor: zinc` (see `components.json`).

## The `dot-` convention

Template files named `dot-<name>` are written as `.<name>` (for example `dot-gitignore` → `.gitignore`). This lets templates ship dotfiles that package managers would otherwise strip.

## Roadmap

Optional, composable modules (`podo add <module>`) — for example PostgreSQL/ORM, Redis, queue+worker, auth, and object storage — are planned so you can grow a project feature by feature. See the repository roadmap for status.
