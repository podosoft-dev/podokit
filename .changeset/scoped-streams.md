---
"@podosoft/podokit": minor
"@podosoft/podokit-runtime": minor
---

Scope event streams and stream stored objects. SSE events carry a topic and an optional audience, each stream receives only the topics and audiences it may read, queues are bounded with a `resync` event, `POST /events` is admin-only, job progress reaches only its owner, and web apps get a shared `EventSource` helper in `$lib/events`. `RequestIdentity` gains `roles()` and `activeOrganizationId()`. The admin sessions and users pages page on the server (`GET`/`DELETE /admin/sessions`), and admin reads use the general rate budget. `ObjectStore.get` returns metadata with a lazily opened stream, `stat()` and paged `list()` are new, `objectResponse()` serves objects with validators and 304, and favicons and profile images stream from storage with versioned favicons cached as immutable. The 2FA QR code loads on demand and idle-timeout tracking writes storage at most every five seconds.
