# @podosoft/podokit-runtime

## 0.5.1

### Patch Changes

- [#244](https://github.com/podosoft-dev/podokit/pull/244) [`9154af2`](https://github.com/podosoft-dev/podokit/commit/9154af27522620d6147ca5a6e3d4357d3e9f2b7c) Thanks [@korone00](https://github.com/korone00)! - Remove finished runs of `JobQueue.schedule()` beyond a limit instead of keeping every one: after a scheduled run finishes, the BullMQ and local providers keep the newest 100 completed and 1000 failed jobs of its name, and a new optional `ScheduleOptions` argument sets `keepCompleted` and `keepFailed` (0 removes only the run). The runtime exports `ScheduleOptions`, `scheduleRetention()`, and the default limits.

## 0.5.0

### Minor Changes

- [#241](https://github.com/podosoft-dev/podokit/pull/241) [`9b5322b`](https://github.com/podosoft-dev/podokit/commit/9b5322bc5e4f2cea726dd62929cce0470eb3b14d) Thanks [@korone00](https://github.com/korone00)! - Repeat jobs through the jobs contract. `JobQueue.schedule(id, name, payload, { cron | everyMs, timezone? })` adds a job on a cron expression or a fixed interval and replaces an earlier schedule with the same id, and `unschedule(id)` stops it. The BullMQ provider stores the schedules as Redis job schedulers and the local provider adds the jobs from a timer, once per time; both apply their schedules again when the connection is restored, resolve `schedule()` while the backend is down, and reject an invalid schedule. The runtime package exports `RepeatOptions`, `assertRepeatOptions()`, and `MIN_REPEAT_INTERVAL_MS`. Implementations of `JobQueue`, including test fakes, need the two new methods.

## 0.4.1

### Patch Changes

- [#232](https://github.com/podosoft-dev/podokit/pull/232) [`28acd36`](https://github.com/podosoft-dev/podokit/commit/28acd3693205038c3ebaefa8e95d0c4ae452aca4) Thanks [@korone00](https://github.com/korone00)! - Path prefixes in the rate-limit module's route profiles (`RATE_LIMIT_ROUTES`), `APP_BODY_LIMITS`, and `APP_PROXY_TIMEOUTS` take `:name` parameters that match exactly one non-empty path segment, such as `/hosts/:hostId/file-transfers` on the API and `/api/hosts/:hostId/file-transfers` on the web proxy. The most specific prefix wins: more segments, then, from the left, a literal segment over a parameter, then the existing tie-breakers. Wildcards, `.` or `..` segments, and malformed names are rejected, and the web lists reject two prefixes that cover the same paths.

## 0.4.0

### Minor Changes

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - Tell SSE clients to reload after an event transport outage. The runtime `EventBus` contract gains an optional `onInterruption(listener)` that a transport calls when delivery resumes after an outage in which events may have been lost, and `subscribe` is documented to register handlers without waiting for the transport. The `sse` module sends one `resync` frame to every open stream when that happens, so clients refetch the state they missed while their stream stayed open.

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - Keep `Content-Length` for local objects up to 2 MiB. Bun keeps the length that `objectResponse` sets only for a body held in memory or read from a file, such as `new Blob([bytes]).stream()`, and sends any other `ReadableStream`, including a `fetch()` response body, chunked (oven-sh/bun#10507). `LocalObjectStore.get()` now reads objects up to the new `IN_MEMORY_READ_BYTES` (2 MiB) whole before it resolves, opening the file with `O_NOFOLLOW` and checking that the path still holds the described file before and after the read, and returns them as an in-memory body; a file replaced during that read is described again. Larger objects still stream in 64 KiB chunks from the first read and go out chunked. The `object-storage-s3` module now takes its 2 MiB limit from `IN_MEMORY_READ_BYTES`.

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - Stream object writes and add multipart uploads. `ObjectBody` now includes `Blob` and `ReadableStream`, and `ObjectStore` gains `createMultipartUpload`, `uploadPart`, `completeMultipartUpload`, and `abortMultipartUpload`, with `MIN_MULTIPART_PART_BYTES`, `MAX_MULTIPART_PARTS`, `MultipartUploadError`, and the `objectBodyChunks`, `assertPartNumber`, and `normalizeCompletedParts` helpers. `LocalObjectStore` writes streamed bodies to a temporary file, keeps multipart parts under `.podokit/multipart/`, and removes idle uploads after `multipartMaxAgeMs`. The S3 module streams large bodies as multipart uploads with bounded memory, signs multipart requests with AWS Signature Version 4, and aborts an upload whose body fails; the local module adds `LOCAL_STORAGE_MULTIPART_MAX_AGE`. Custom `ObjectStore` implementations must add the four multipart methods.

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - Add rate-limit route profiles. The runtime exports `RATE_LIMIT_ROUTES` with the `RateLimitRoute`, `RateLimitProfile`, and `RateLimitRouteRegistry` contracts, and the rate-limit module registers the registry and re-exports the key. `register({ method?, pathPrefix, profile })` gives a path prefix its own budget (`{ name, limit, ttlSeconds? }`) or `"exempt"`; the most specific prefix wins, then a route with a method, then the latest registration. The general, authentication, and runtime budgets are now registered routes, with the same limits as before. Modules resolve the registry with `tryResolve`, so they work without rate limiting installed.

### Patch Changes

- [#222](https://github.com/podosoft-dev/podokit/pull/222) [`b41f088`](https://github.com/podosoft-dev/podokit/commit/b41f0883ce9b02497097df2e849df73946c17791) Thanks [@korone00](https://github.com/korone00)! - Read S3 objects with one request and keep the `Content-Length` of small ones. In the `object-storage-s3` module, `StorageService.open()`, which backs `OBJECT_STORAGE.get()`, sends one presigned GET instead of a HEAD followed by a GET with `If-Match`, takes the metadata from that response, and reads objects up to 2 MiB into memory, because Bun sends any other streamed body with chunked encoding and drops the length that `objectResponse` sets. Larger objects stream from the GET, which stays open until the body is read or cancelled. A missing bucket now throws instead of resolving `null`. The runtime's `ObjectData.body` documentation no longer promises a body that opens on its first read.

## 0.3.0

### Minor Changes

- [#217](https://github.com/podosoft-dev/podokit/pull/217) [`a8c131d`](https://github.com/podosoft-dev/podokit/commit/a8c131dfebb5fe9c93655cb03dce713aa0cee244) Thanks [@korone00](https://github.com/korone00)! - Scope event streams and stream stored objects. SSE events carry a topic and an optional audience, each stream receives only the topics and audiences it may read, queues are bounded with a `resync` event, `POST /events` is admin-only, job progress reaches only its owner, and web apps get a shared `EventSource` helper in `$lib/events`. `RequestIdentity` gains `roles()` and `activeOrganizationId()`. The admin sessions and users pages page on the server (`GET`/`DELETE /admin/sessions`), and admin reads use the general rate budget. `ObjectStore.get` returns metadata with a lazily opened stream, `stat()` and paged `list()` are new, `objectResponse()` serves objects with validators and 304, and favicons and profile images stream from storage with versioned favicons cached as immutable. The 2FA QR code loads on demand and idle-timeout tracking writes storage at most every five seconds.

## 0.2.0

### Minor Changes

- [#187](https://github.com/podosoft-dev/podokit/pull/187) [`77abca6`](https://github.com/podosoft-dev/podokit/commit/77abca69c99ff284a600e139e9664590483e3e75) Thanks [@korone00](https://github.com/korone00)! - Add provider-neutral database, cache, object storage, event, and job contracts with selectable distributed and local implementations.
  
  Add dry-run-first provider inspection and switching for existing generated projects, SQLite project generation, provider-aware deployment profiles, and local single-process modules for desktop applications.
  
  Generalize the auth configuration store around a database-neutral repository contract.
