import { Elysia, t } from "elysia";
import { OBJECT_STORAGE } from "@podosoft/podokit-runtime";
import type { AppPlugin, PodokitModule } from "../core/services";

const filesPlugin: AppPlugin = ({ services }) => {
  const storage = services.resolve(OBJECT_STORAGE);
  return new Elysia({ name: "podokit.files" })
    .post("/files", async ({ body, set }) => {
      const safeName = body.file.name.replace(/[^\w.-]+/g, "_");
      const key = `uploads/${crypto.randomUUID()}-${safeName}`;
      await storage.put(
        key,
        new Uint8Array(await body.file.arrayBuffer()),
        { contentType: body.file.type },
      );
      set.status = 201;
      return { key, url: await storage.getDownloadUrl(key) };
    }, {
      body: t.Object({ file: t.File() }),
      detail: { tags: ["files"], summary: "Upload a file" },
    })
    .get("/files/:key/url", async ({ params }) => ({
      url: await storage.getDownloadUrl(params.key),
    }), {
      params: t.Object({ key: t.String({ minLength: 1 }) }),
      detail: { tags: ["files"], summary: "Presign a file download" },
    });
};

export const filesModule: PodokitModule = {
  name: "file-upload",
  plugin: filesPlugin,
};
