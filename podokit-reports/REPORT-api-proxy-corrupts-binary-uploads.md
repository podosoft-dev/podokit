# SvelteKit API proxy corrupts binary multipart uploads

## Summary

The generated SvelteKit API proxy reads every request body as text before
forwarding it. Binary multipart file contents are changed during UTF-8 decoding,
so the NestJS API receives corrupted files.

## Environment

- PodoKit / CLI version: `@podosoft/podokit` 0.9.0
- Template: `fullstack-nest-svelte`
- Modules added: auth, admin-dashboard, object-storage-s3, file-upload, blog
- Run mode: containerized `compose.dev.yaml`
- OS / Node / package manager: macOS 26.5.1 / Node 25.8.1 / npm 11.17.0

## Steps to reproduce

1. Create a `fullstack-nest-svelte` application and add `auth`, `file-upload`,
   and a multipart endpoint that validates PNG signature bytes.
2. Run the generated application with `docker compose watch`.
3. Sign in and send a PNG in a multipart `file` field through the SvelteKit
   `/api` proxy.
4. Inspect the file buffer received by NestJS or validate its PNG signature.

## Expected

The API receives the same bytes that the browser sent, and the PNG signature is
valid.

## Actual

The PNG is rejected because its signature bytes have changed. The observed
request returned HTTP 400 with `BLOG_IMAGE_TYPE_INVALID` in two generated
applications using the same proxy.

## Evidence

The generated proxy contains:

```ts
body: hasBody ? await request.text() : undefined,
```

A 68-byte PNG uploaded through `/api/blog/images` returned HTTP 400 with:

```json
{"success":false,"error":{"code":"BLOG_IMAGE_TYPE_INVALID","message":"Only PNG, JPEG, GIF, WebP, and AVIF images are supported.","statusCode":400,"path":"/blog/images"}}
```

The same failure occurred in both the reference admin application and the
consumer homepage application.

## Suspected root cause / suggested fix (optional)

`templates/fullstack-nest-svelte/apps/web/src/lib/server/backend-proxy.ts` and
the equivalent todo template call `request.text()`. Forward
`await request.arrayBuffer()` instead so JSON, form data, and binary multipart
bodies are preserved byte-for-byte.
