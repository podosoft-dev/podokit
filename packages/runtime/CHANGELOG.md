# @podosoft/podokit-runtime

## 0.3.0

### Minor Changes

- [#217](https://github.com/podosoft-dev/podokit/pull/217) [`a8c131d`](https://github.com/podosoft-dev/podokit/commit/a8c131dfebb5fe9c93655cb03dce713aa0cee244) Thanks [@korone00](https://github.com/korone00)! - Scope event streams and stream stored objects. SSE events carry a topic and an optional audience, each stream receives only the topics and audiences it may read, queues are bounded with a `resync` event, `POST /events` is admin-only, job progress reaches only its owner, and web apps get a shared `EventSource` helper in `$lib/events`. `RequestIdentity` gains `roles()` and `activeOrganizationId()`. The admin sessions and users pages page on the server (`GET`/`DELETE /admin/sessions`), and admin reads use the general rate budget. `ObjectStore.get` returns metadata with a lazily opened stream, `stat()` and paged `list()` are new, `objectResponse()` serves objects with validators and 304, and favicons and profile images stream from storage with versioned favicons cached as immutable. The 2FA QR code loads on demand and idle-timeout tracking writes storage at most every five seconds.

## 0.2.0

### Minor Changes

- [#187](https://github.com/podosoft-dev/podokit/pull/187) [`77abca6`](https://github.com/podosoft-dev/podokit/commit/77abca69c99ff284a600e139e9664590483e3e75) Thanks [@korone00](https://github.com/korone00)! - Add provider-neutral database, cache, object storage, event, and job contracts with selectable distributed and local implementations.
  
  Add dry-run-first provider inspection and switching for existing generated projects, SQLite project generation, provider-aware deployment profiles, and local single-process modules for desktop applications.
  
  Generalize the auth configuration store around a database-neutral repository contract.
