# Blog public routes require a session after module installation

## Summary
The blog module describes its read routes as public, but it does not register the
`/blog` page prefix in the generated web layout's public path list. Anonymous
visitors are redirected to sign-in before the public blog loader can run.

## Environment
- PodoKit / CLI version: `@podosoft/podokit` 0.9.0, local source build
- Template: `fullstack-nest-svelte`
- Modules added: `auth`, `admin-dashboard`, `blog`
- Run mode: containerized `compose.dev.yaml`
- OS / Node / package manager: macOS 26.5.1 / Node 25.8.1 / npm 11.17.0

## Steps to reproduce
1. Create a `fullstack-nest-svelte` application.
2. Add `auth`, `admin-dashboard`, and the external `blog` module.
3. Open `/blog` without a session.

## Expected
The paginated blog list and published article pages should be readable without a
session. Only writing, commenting, and management actions should require sign-in.

## Actual
The root `+layout.server.ts` redirects the request to
`/login?redirect=%2Fblog` because the module does not inject `/blog` between the
`public-paths` markers.

## Evidence
An anonymous `GET /blog` returned HTTP 303 with `Location:
/login?redirect=%2Fblog` in a clean reference application. The generated layout's
`PUBLIC_PATHS` array contained the module injection markers but no `/blog` entry.

## Suspected root cause / suggested fix (optional)
Add an optional module manifest injection that inserts `"/blog"` at
`// podokit:end:public-paths` in `apps/web/src/routes/+layout.server.ts`.
