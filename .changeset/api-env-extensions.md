---
"@podosoft/podokit": minor
---

Add the application-owned `apps/api/src/config/env.extensions.ts`. Its `appEnvShape` fields are validated with PodoKit's environment at startup and typed on `AppEnv`, and `refineAppEnv(env, context)` adds cross-variable checks, so apps stop editing the managed `env.validation.ts`. Redefining a PodoKit variable fails at startup. `podo update` seeds the file once.
