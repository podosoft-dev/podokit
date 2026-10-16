---
"@podosoft/podokit": patch
---

Let sign-in work once `migrate:all` has run, even when the API started before it. Better Auth keeps a schema mismatch it found until a migration in the same process clears it, so an API that started on an empty database answered every sign-in with `500` until it restarted. While the auth instance holds a mismatch, the auth module rebuilds it at most every 2 seconds on a request, and the new instance checks the database again.
