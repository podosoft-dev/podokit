import { AppException } from "@podosoft/podokit-contracts";
import { Elysia, t } from "elysia";
import { OBJECT_STORAGE, type ObjectStore } from "@podosoft/podokit-runtime";
import {
  REQUEST_IDENTITY,
  type AppPlugin,
  type ElysiaPlugin,
  type PodokitModule,
  type RequestIdentity,
} from "../core/services";
import { uploadAccess, uploadKey } from "./upload-keys";

export function filesRoutes(storage: ObjectStore, identity: RequestIdentity): ElysiaPlugin {
  return new Elysia({ name: "podokit.files" })
    .post("/files", async ({ request, body, set }) => {
      const key = uploadKey(await identity.userId(request), body.file.name);
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
    .get("/files/:key/url", async ({ request, params }) => {
      const access = uploadAccess(params.key, {
        userId: await identity.userId(request),
        admin: await identity.isAdmin(request),
      });
      if (access === "not-found") throw new AppException("FILE_NOT_FOUND", "File not found", 404);
      if (access === "forbidden") {
        throw new AppException("FILE_FORBIDDEN", "You cannot access this file", 403);
      }
      return { url: await storage.getDownloadUrl(params.key) };
    }, {
      params: t.Object({ key: t.String({ minLength: 1, maxLength: 1024 }) }),
      detail: {
        tags: ["files"],
        summary: "Presign a download of your upload",
        description: "Pass the upload key URL-encoded as one path segment. Owners and administrators only.",
      },
    });
}

const filesPlugin: AppPlugin = ({ services }) =>
  filesRoutes(services.resolve(OBJECT_STORAGE), services.resolve(REQUEST_IDENTITY));

export const filesModule: PodokitModule = {
  name: "file-upload",
  plugin: filesPlugin,
};
