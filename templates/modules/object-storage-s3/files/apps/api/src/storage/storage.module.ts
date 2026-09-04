import { Elysia, t } from "elysia";
import { OBJECT_STORAGE } from "@podosoft/podokit-runtime";
import { PROVIDERS } from "../config/providers";
import {
  type AppPlugin,
  type PodokitModule,
  READINESS,
  type ServiceKey,
} from "../core/services";
import { StorageService } from "./storage.service";
import { S3ObjectStore } from "./s3-object.store";

export const STORAGE = Symbol("storage") as ServiceKey<StorageService>;

const storagePlugin: AppPlugin = ({ services }) => {
  if (PROVIDERS["object-storage"] !== "s3") {
    return new Elysia({ name: "podokit.storage-s3.inactive" });
  }
  const storage = services.resolve(STORAGE);
  return new Elysia({ name: "podokit.storage" })
    .put("/storage/:key", async ({ params, body }) => {
      await storage.put(params.key, body.content, "text/plain");
      return { key: params.key };
    }, {
      params: t.Object({ key: t.String({ minLength: 1 }) }),
      body: t.Object({ content: t.String() }),
      detail: { tags: ["storage"], summary: "Store an object" },
    })
    .get("/storage/:key/presigned", async ({ params }) => ({
      url: await storage.presignedGetUrl(params.key),
    }), {
      params: t.Object({ key: t.String({ minLength: 1 }) }),
      detail: { tags: ["storage"], summary: "Presign an object download" },
    })
    .get("/storage/:key", async ({ params }) => ({
      key: params.key,
      content: (await storage.get(params.key)).toString("utf8"),
    }), {
      params: t.Object({ key: t.String({ minLength: 1 }) }),
      detail: { tags: ["storage"], summary: "Read an object" },
    });
};

export const storageModule: PodokitModule = {
  name: "object-storage-s3",
  configure: (_env, services): void => {
    if (PROVIDERS["object-storage"] !== "s3") return;
    const storage = new StorageService(services.resolve(READINESS));
    services.register(STORAGE, storage, () => storage.close());
    services.register(OBJECT_STORAGE, new S3ObjectStore(storage));
  },
  plugin: storagePlugin,
};
