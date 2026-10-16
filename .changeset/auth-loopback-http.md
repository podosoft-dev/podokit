---
"@podosoft/podokit": patch
---

Accept an `http:` `BETTER_AUTH_URL` on a loopback address in production, such as an API a desktop shell runs on `127.0.0.1`, so apps stop editing the managed `auth-environment.ts`. Every other address still needs `https:`.
