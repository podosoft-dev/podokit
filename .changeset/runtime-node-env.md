---
"@podosoft/podokit": patch
---

Read `NODE_ENV` at run time in the built API. `Bun.build` replaced `process.env.NODE_ENV` with `"development"` in every bundle, so production images loaded the development-only `pino-pretty` transport, skipped the production checks on `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`, ran no SQLite migrations, and left dependencies on their development branches. `scripts/build.mjs` now keeps `process.env.NODE_ENV` a runtime read for the API, worker, and migration bundles, and the logging module reads the validated `NODE_ENV`.
