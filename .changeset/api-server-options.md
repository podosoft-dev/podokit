---
"@podosoft/podokit": minor
---

Let applications set the API's Bun server options. The managed `main.ts` passes the optional `apiServerOptions` export of the owned `app.extensions.ts` (`maxRequestBodySize`, `idleTimeout`, or a function of the validated environment) to `app.listen`, and `API_MAX_REQUEST_BODY_SIZE` sets the request body limit when the export leaves it out (default 128 MiB, Bun's default). Extension files from earlier releases, which lack the export, keep compiling.
