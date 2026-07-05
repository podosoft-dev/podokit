# Examples

PodoKit generates projects rather than vendoring large example apps, so the
canonical example is what `podo create` produces.

## basic-fullstack

Generate the default full-stack app (NestJS API + SvelteKit web):

```bash
npx @podosoft/podokit create basic-fullstack
cd basic-fullstack
npm install
cp .env.example .env
npm run dev
```

- API: http://localhost:3000 (`/health`)
- Web: http://localhost:5173

Start local services (PostgreSQL, Redis):

```bash
docker compose -f infra/docker/docker-compose.yml up -d
```

For a minimal, dependency-light layout instead, use `--template base`.
