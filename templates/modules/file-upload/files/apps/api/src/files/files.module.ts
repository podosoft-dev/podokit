import { Elysia, t } from "elysia";
import type { AppPlugin, PodokitModule } from "../core/services";
import { STORAGE } from "../storage/storage.module";

const filesPlugin: AppPlugin = ({ services }) => {
  const storage = services.resolve(STORAGE);
  return new Elysia({ name: "podokit.files" })
    .post("/files", async ({ body, set }) => {
      const safeName = body.file.name.replace(/[^\w.-]+/g, "_");
      const key = `uploads/${crypto.randomUUID()}-${safeName}`;
      await storage.put(key, new Uint8Array(await body.file.arrayBuffer()), body.file.type);
      set.status = 201;
      return { key, url: await storage.presignedGetUrl(key) };
    }, {
      body: t.Object({ file: t.File() }),
      detail: { tags: ["files"], summary: "Upload a file" },
    })
    .get("/files/:key/url", async ({ params }) => ({
      url: await storage.presignedGetUrl(params.key),
    }), {
      params: t.Object({ key: t.String({ minLength: 1 }) }),
      detail: { tags: ["files"], summary: "Presign a file download" },
    });
};

export const filesModule: PodokitModule = {
  name: "file-upload",
  plugin: filesPlugin,
};
