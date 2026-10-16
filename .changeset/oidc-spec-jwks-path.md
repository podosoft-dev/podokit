---
"@podosoft/podokit": patch
---

The admin dashboard's `oidc.ui.spec.ts` reads the JWKS through the app under test. It requested discovery's `jwks_uri` directly, which fails when `BETTER_AUTH_URL` is a public origin the runner cannot use, such as a tunnel set as `publicUrl` in `.podokit/dev.json` that answers with an access login page; it now checks that `jwks_uri` has the issuer's origin and requests its path from the tested app.
