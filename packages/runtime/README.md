# @podosoft/podokit-runtime

Provider-neutral runtime contracts and local providers for PodoKit applications.

The package defines stable service keys and contracts for database, cache, object
storage, events, and jobs. It also includes bounded in-process cache and event
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

The body is opened only when it is first read, so reading the metadata costs no
download. Read the body to the end or cancel it. `stat(key)` returns the
metadata alone.

`objectResponse()` turns an object into an HTTP response without buffering it.
It sets `content-type`, `content-length`, `etag`, and `last-modified`, and it
answers a matching `If-None-Match` (or, without one, `If-Modified-Since`) with
`304` and cancels the body unread:

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
