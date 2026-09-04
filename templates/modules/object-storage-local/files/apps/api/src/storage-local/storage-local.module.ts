import {
  LocalObjectStore,
  OBJECT_STORAGE,
  type ObjectData,
} from "@podosoft/podokit-runtime";
import { Elysia, t } from "elysia";
import { resolve } from "node:path";
import type { AppPlugin, PodokitModule } from "../core/services";
import { PROVIDERS } from "../config/providers";

function responseBody(object: ObjectData): ReadableStream<Uint8Array> {
  const iterator = object.body[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller): Promise<void> {
      const next = await iterator.next();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    async cancel(): Promise<void> {
      await iterator.return?.();
    },
  });
}

const localStoragePlugin: AppPlugin = ({ services }) => {
  if (PROVIDERS["object-storage"] !== "local") {
    return new Elysia({ name: "podokit.storage-local.inactive" });
  }
  const storage = services.resolve(OBJECT_STORAGE);
  return new Elysia({ name: "podokit.storage-local" })
    .get("/files/content/*", async ({ params, set }) => {
      const object = await storage.get(params["*"]);
      if (object.contentType) set.headers["content-type"] = object.contentType;
      set.headers["content-length"] = String(object.size);
      return new Response(responseBody(object));
    }, {
      detail: { tags: ["files"], summary: "Read a local object" },
    })
    .put("/storage/:key", async ({ params, body }) => {
      await storage.put(params.key, body.content, { contentType: "text/plain" });
      return { key: params.key };
    }, {
      params: t.Object({ key: t.String({ minLength: 1 }) }),
      body: t.Object({ content: t.String() }),
      detail: { tags: ["storage"], summary: "Store an object" },
    });
};

export const storageLocalModule: PodokitModule = {
  name: "object-storage-local",
  configure: (_env, services): void => {
    if (PROVIDERS["object-storage"] !== "local") return;
    const storage = new LocalObjectStore({
      rootDirectory: resolve(process.env.LOCAL_STORAGE_PATH ?? "./data/files"),
      publicBaseUrl: "/files/content",
    });
    services.register(OBJECT_STORAGE, storage, () => storage.close());
  },
  plugin: localStoragePlugin,
};
