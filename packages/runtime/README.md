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
