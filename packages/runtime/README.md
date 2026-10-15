# @podosoft/podokit-runtime

Provider-neutral runtime contracts and local providers for PodoKit applications.

The package defines stable service keys and contracts for database, cache, object
storage, events, and jobs, plus `RATE_LIMIT_ROUTES`, which the rate-limit module
registers so other modules can give their routes a request budget of their own. It also includes bounded in-process cache and event
providers plus an atomic, path-confined local object store. Distributed providers
implement the same contracts in PodoKit modules.

```ts
import { LocalObjectStore, MemoryCacheStore } from "@podosoft/podokit-runtime";

const cache = new MemoryCacheStore({ maxEntries: 10_000 });
await cache.set("greeting", "hello", { ttlMs: 30_000 });

const objects = new LocalObjectStore({
  rootDirectory: "/var/lib/podokit/files",
  publicBaseUrl: "/files/content",
});
await objects.put("uploads/hello.txt", "hello", { contentType: "text/plain" });
```

Local providers are intended for a single application process or desktop runtime.
Use distributed providers when multiple API or worker replicas share state.

## Object storage

`ObjectStore.get(key)` resolves `null` for a missing key. Otherwise it returns the
object's metadata and a `ReadableStream` body:

| Field | Meaning |
| --- | --- |
| `size` | Content length in bytes |
| `contentType` | The type given to `put()`, when known |
| `etag` | An HTTP entity tag, quotes included, that changes with the content |
| `lastModified` | When the content was last written |

Read the body to the end or cancel it. A provider may open it on the first read,
as `LocalObjectStore` does, or have the download under way when `get()`
resolves, so an abandoned body can hold a file handle or connection.
`stat(key)` returns the metadata alone, without reading the content.

`objectResponse()` turns an object into an HTTP response without buffering it.
It sets `content-type`, `content-length`, `etag`, and `last-modified`, and it
answers a matching `If-None-Match` (or, without one, `If-Modified-Since`) with
`304` and cancels the body unread. Bun keeps the `content-length` only for a
body held in memory or read from a file, such as `new Blob([bytes]).stream()` or
`Bun.file().stream()`. It sends any other `ReadableStream`, including a `fetch()`
response body and the file stream of `LocalObjectStore`, with
`Transfer-Encoding: chunked` and drops the length, except sometimes for a few
KiB or less ([oven-sh/bun#10507](https://github.com/oven-sh/bun/issues/10507)):

```ts
import { objectResponse } from "@podosoft/podokit-runtime";

const object = await objects.get("uploads/hello.txt");
if (!object) return new Response(null, { status: 404 });
return objectResponse(request, object, { cacheControl: "no-cache" });
```

`readObjectBytes(store, key)` reads a small object into one buffer. It rejects
objects larger than `maxBytes` (16 MiB by default) before reading them.

`list(prefix, { cursor, limit })` returns one page of keys in ascending order.
Pass the returned `nextCursor` as `cursor` until it is absent:

```ts
let cursor: string | undefined;
do {
  const page = await objects.list("uploads/", { limit: 500, cursor });
  for (const key of page.keys) console.log(key);
  cursor = page.nextCursor;
} while (cursor);
```

`limit` ranges from 1 to 1000 and defaults to 1000. Cursors are opaque.

### Writing large objects

`put(key, body)` accepts a `Uint8Array`, a string, a `Blob` (including a file),
a `ReadableStream<Uint8Array>`, or an `AsyncIterable<Uint8Array>`. Providers
write streamed bodies as they are read instead of collecting them first, so a
request body can go straight to storage:

```ts
await objects.put(`uploads/${id}`, request.body!, { contentType: "video/mp4" });
```

If the body fails part way, the write is abandoned and no partial object is
left under the key. `objectBodyChunks(body)` reads any of these bodies as byte
chunks for code that implements `ObjectStore` itself.

### Multipart uploads

A multipart upload assembles one object from numbered parts that can be
uploaded separately, in any order, and retried, for example one part per HTTP
request of a resumable upload:

```ts
import { MIN_MULTIPART_PART_BYTES, MultipartUploadError } from "@podosoft/podokit-runtime";

const { uploadId } = await objects.createMultipartUpload("uploads/movie.mp4", {
  contentType: "video/mp4",
});
const first = await objects.uploadPart("uploads/movie.mp4", uploadId, 1, chunkOne);
const second = await objects.uploadPart("uploads/movie.mp4", uploadId, 2, chunkTwo);
const info = await objects.completeMultipartUpload("uploads/movie.mp4", uploadId, [
  { partNumber: 1, etag: first.etag },
  { partNumber: 2, etag: second.etag },
]);
// or: await objects.abortMultipartUpload("uploads/movie.mp4", uploadId);
```

| Rule | Value |
| --- | --- |
| Part numbers | 1 to `MAX_MULTIPART_PARTS` (10,000) |
| Part size | at least `MIN_MULTIPART_PART_BYTES` (5 MiB), except the last part |
| Upload again | the same part number replaces the earlier part and its etag |
| Complete | parts are joined in part-number order; parts not listed are discarded |
| Abort | removes every part; aborting an upload that no longer exists succeeds |

Nothing is visible under the key until the upload completes. Every call
validates the key the same way `put` does. Failures that a caller can act on
throw `MultipartUploadError` with a provider-neutral `code`:

| Code | Meaning |
| --- | --- |
| `UPLOAD_NOT_FOUND` | Unknown upload id, another key's id, or an upload that was completed, aborted, or expired |
| `INVALID_PART` | A listed part was never uploaded or its etag no longer matches |
| `PART_TOO_SMALL` | A part other than the last is below the minimum size |

Invalid part numbers or part lists throw `RangeError` or `TypeError` before
any storage request. Upload ids and etags are opaque and provider-specific.

`LocalObjectStore` keeps parts under `<rootDirectory>/.podokit/multipart/<uploadId>/`,
which listings never include. Completing streams the parts in order into a
temporary file and renames it into place. Uploads without activity for
`multipartMaxAgeMs` (24 hours by default) are removed when a later upload
starts, at most once an hour, or on demand with `abortStaleMultipartUploads()`.
