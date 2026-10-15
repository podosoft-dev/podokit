import { AppException } from "@podosoft/podokit-contracts";
import { Elysia, t } from "elysia";
import { OBJECT_STORAGE, RATE_LIMIT_ROUTES, type ObjectStore } from "@podosoft/podokit-runtime";
import { apiServerOptions } from "../config/server-options";
import {
  DATABASE,
  LOGGER,
  REQUEST_IDENTITY,
  type AppPlugin,
  type ElysiaPlugin,
  type PodokitModule,
  type RequestIdentity,
  type ServiceKey,
} from "../core/services";
import { ChunkedUploads } from "./chunked-uploads";
import { allowedOrigins, chunkedUploadRoutes } from "./chunked-uploads.routes";
import { uploadConfig } from "./upload-config";
import { uploadAccess, uploadKey } from "./upload-keys";

export const CHUNKED_UPLOADS = Symbol("chunked-uploads") as ServiceKey<ChunkedUploads>;

export function filesRoutes(storage: ObjectStore, identity: RequestIdentity): ElysiaPlugin {
  return new Elysia({ name: "podokit.files" })
    .post("/files", async ({ request, body, set }) => {
      const key = uploadKey(await identity.userId(request), body.file.name);
      await storage.put(key, body.file, { contentType: body.file.type });
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

const filesPlugin: AppPlugin = ({ env, services }) => {
  const uploads = services.resolve(CHUNKED_UPLOADS);
  const identity = services.resolve(REQUEST_IDENTITY);
  // Registered here rather than in configure: rate-limit may configure later.
  services.tryResolve(RATE_LIMIT_ROUTES)?.register({
    method: "PUT",
    pathPrefix: "/files/uploads",
    profile: { name: "file-uploads", limit: uploads.settings.rateLimitMax },
  });
  return new Elysia({ name: "podokit.files.module" })
    .use(filesRoutes(services.resolve(OBJECT_STORAGE), identity))
    .use(chunkedUploadRoutes(uploads, identity, allowedOrigins(env.CORS_ORIGIN)));
};

export const filesModule: PodokitModule = {
  name: "file-upload",
  configure: (env, services): void => {
    const database = services.resolve(DATABASE);
    const uploads = new ChunkedUploads({
      sql: database.sql,
      dialect: database.provider,
      config: uploadConfig(process.env, apiServerOptions(env).maxRequestBodySize),
      // Resolved on use: an application may replace these after this point.
      storage: () => services.resolve(OBJECT_STORAGE),
      logger: { warn: (details, message) => services.resolve(LOGGER).warn(details, message) },
    });
    services.register(CHUNKED_UPLOADS, uploads, () => uploads.close());
    services.onStart(() => uploads.start());
  },
  plugin: filesPlugin,
};
