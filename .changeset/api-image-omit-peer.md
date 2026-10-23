---
"@podosoft/podokit": patch
---

The generated API Dockerfile installs runtime dependencies with `bun install --production --omit=peer`. Without `--omit=peer`, Bun also installed peer dependencies that other workspaces had resolved in the lockfile, so the API image carried `vitest`, `vite`, `svelte`, `@sveltejs/kit`, and `typescript` through Better Auth's optional peers. In a generated app with auth, admin, and mailer modules the API image drops from 420 MB to 300 MB (`node_modules` 180 MB to 87 MB, 263 to 177 packages), and the API still migrates, starts, and serves authentication. Existing projects pick up the managed Dockerfile with `podo update`.
