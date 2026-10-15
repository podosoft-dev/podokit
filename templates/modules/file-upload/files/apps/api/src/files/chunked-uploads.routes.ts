import { AppException } from "@podosoft/podokit-contracts";
import { Elysia, t } from "elysia";
import type { ElysiaPlugin, RequestIdentity } from "../core/services";
import type { ChunkedUploads } from "./chunked-uploads";

const JSON_TYPE = "application/json";
const BINARY_TYPE = "application/octet-stream";
const CONTENT_TYPE = "^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+(\\s*;.*)?$";

const uploadId = t.Object({ id: t.String({ minLength: 1, maxLength: 64 }) });

/** The origins in CORS_ORIGIN, which a browser's Origin header must match. */
export function allowedOrigins(corsOrigin: string | undefined): string[] {
  return (corsOrigin ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
    .map((origin) => {
      try {
        return new URL(origin).origin;
      } catch {
        return origin;
      }
    });
}

function mediaType(request: Request): string {
  return (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

/**
 * Upload routes may be served on a direct API path, which skips the web
 * server's cross-site form check. Requiring a JSON or binary content type makes
 * every cross-origin browser request preflighted, which CORS refuses for other
 * origins, and a browser Origin outside CORS_ORIGIN is rejected outright.
 */
function guard(origins: readonly string[], type?: string): (context: { request: Request }) => void {
  return ({ request }) => {
    const origin = request.headers.get("origin");
    if (origins.length > 0 && origin !== null && !origins.includes(origin)) {
      throw new AppException("ORIGIN_NOT_ALLOWED", "Requests from this origin cannot change uploads", 403);
    }
    if (type !== undefined && mediaType(request) !== type) {
      throw new AppException("UNSUPPORTED_MEDIA_TYPE", `Send this request as ${type}`, 415);
    }
  };
}

function declaredLength(request: Request): number | null {
  const value = request.headers.get("content-length");
  if (value === null) return null;
  return /^\d+$/.test(value.trim()) ? Number(value) : Number.NaN;
}

/**
 * Resumable uploads: create a session, PUT its parts in any order (again to
 * replace one), read the status to resume, then complete or delete it. Only the
 * owner sees a session; others receive 404 so session ids cannot be probed.
 */
export function chunkedUploadRoutes(
  uploads: ChunkedUploads,
  identity: RequestIdentity,
  origins: readonly string[],
): ElysiaPlugin {
  return new Elysia({ name: "podokit.files.uploads" })
    .post("/files/uploads", async ({ request, body, set }) => {
      const created = await uploads.create(await identity.userId(request), body);
      set.status = 201;
      return created;
    }, {
      transform: guard(origins, JSON_TYPE),
      body: t.Object({
        filename: t.String({ minLength: 1, maxLength: 255 }),
        size: t.Integer({ minimum: 1 }),
        contentType: t.Optional(t.String({ maxLength: 255, pattern: CONTENT_TYPE })),
      }),
      detail: {
        tags: ["files"],
        summary: "Start a resumable upload",
        description:
          "Returns the session id, the part size, and the part count. Send every part with PUT /files/uploads/{id}/parts/{partNumber}, then complete the upload.",
      },
    })
    .get("/files/uploads/:id", async ({ request, params }) =>
      uploads.status(await identity.userId(request), params.id), {
      params: uploadId,
      detail: {
        tags: ["files"],
        summary: "Read a resumable upload",
        description: "Lists the stored part numbers, so a client can resume by sending the others.",
      },
    })
    .put("/files/uploads/:id/parts/:partNumber", async ({ request, params }) =>
      uploads.putPart(
        await identity.userId(request),
        params.id,
        params.partNumber,
        declaredLength(request),
        request.body,
      ), {
      // The body is streamed to storage as it arrives, never parsed or buffered here.
      parse: "none",
      transform: guard(origins, BINARY_TYPE),
      params: t.Object({ id: t.String({ minLength: 1, maxLength: 64 }), partNumber: t.Numeric() }),
      detail: {
        tags: ["files"],
        summary: "Store one part of a resumable upload",
        description:
          "Send the raw bytes as application/octet-stream with a Content-Length equal to the part size (the last part holds the remainder). Sending a part again replaces it.",
        requestBody: {
          required: true,
          content: { [BINARY_TYPE]: { schema: { type: "string", format: "binary" } } },
        },
      },
    })
    .post("/files/uploads/:id/complete", async ({ request, params }) =>
      uploads.complete(await identity.userId(request), params.id), {
      transform: guard(origins, JSON_TYPE),
      params: uploadId,
      body: t.Optional(t.Object({})),
      detail: {
        tags: ["files"],
        summary: "Complete a resumable upload",
        description:
          "Joins the parts into the stored file once every part is present. Repeating the call returns the same result.",
      },
    })
    .delete("/files/uploads/:id", async ({ request, params, set }) => {
      await uploads.abort(await identity.userId(request), params.id);
      set.status = 204;
    }, {
      transform: guard(origins),
      params: uploadId,
      detail: { tags: ["files"], summary: "Cancel a resumable upload and discard its parts" },
    });
}
