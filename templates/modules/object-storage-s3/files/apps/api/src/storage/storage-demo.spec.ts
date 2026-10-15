import { describe, expect, it } from "bun:test";
import { AppException } from "@podosoft/podokit-contracts";
import { Elysia } from "elysia";
import type { RequestIdentity } from "../core/services";
import { storageDemoRoutes, type DemoStorage } from "./storage.module";

interface MemoryStorage extends DemoStorage {
  objects: Map<string, string>;
  presigned: string[];
}

function memoryStorage(): MemoryStorage {
  const objects = new Map<string, string>();
  const presigned: string[] = [];
  return {
    objects,
    presigned,
    put: async (key, body) => {
      if (typeof body === "string") objects.set(key, body);
      else if (body instanceof Blob) objects.set(key, await body.text());
      else objects.set(key, Buffer.from(body).toString("utf8"));
    },
    get: async (key) => Buffer.from(objects.get(key) ?? ""),
    exists: async (key) => objects.has(key),
    presignedGetUrl: async (key) => {
      presigned.push(key);
      return `https://storage.example.com/${key}?signature=test`;
    },
  };
}

function caller(userId: string | undefined, admin = false): RequestIdentity {
  return {
    userId: async () => userId,
    isAdmin: async () => admin,
    roles: async () => (admin ? ["admin"] : []),
    activeOrganizationId: async () => undefined,
  };
}

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

async function call(
  storage: DemoStorage,
  identity: RequestIdentity,
  method: "GET" | "PUT",
  path: string,
  content?: string,
): Promise<Reply> {
  const app = new Elysia()
    .onError(({ code, error, set }) => {
      if (error instanceof AppException) {
        set.status = error.statusCode;
        return { code: error.code };
      }
      if (code === "VALIDATION") {
        set.status = 400;
        return { code: "VALIDATION_ERROR" };
      }
      if (code === "NOT_FOUND") {
        set.status = 404;
        return { code: "NOT_FOUND" };
      }
      return undefined;
    })
    .use(storageDemoRoutes(storage, identity));
  const response = await app.handle(new Request(`http://localhost${path}`, {
    method,
    ...(content === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify({ content }) }),
  }));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

describe("object storage demo routes", () => {
  it("require a signed-in administrator", async () => {
    const storage = memoryStorage();

    expect(await call(storage, caller(undefined), "PUT", "/storage/hello", "x")).toEqual({
      status: 401,
      body: { code: "AUTH_REQUIRED" },
    });
    for (const [method, path] of [
      ["PUT", "/storage/hello"],
      ["GET", "/storage/hello"],
      ["GET", "/storage/hello/presigned"],
    ] as const) {
      const reply = await call(storage, caller("user-1"), method, path, method === "PUT" ? "x" : undefined);
      expect(reply).toEqual({ status: 403, body: { code: "ADMIN_REQUIRED" } });
    }
    expect(storage.objects.size).toBe(0);
    expect(storage.presigned).toEqual([]);
  });

  it("stores, reads, and presigns objects under the demo prefix for administrators", async () => {
    const storage = memoryStorage();
    const admin = caller("admin-1", true);

    expect(await call(storage, admin, "PUT", "/storage/hello", "hi")).toEqual({
      status: 200,
      body: { key: "hello" },
    });
    expect([...storage.objects.keys()]).toEqual(["demo/hello"]);
    expect(await call(storage, admin, "GET", "/storage/hello")).toEqual({
      status: 200,
      body: { key: "hello", content: "hi" },
    });
    const presigned = await call(storage, admin, "GET", "/storage/hello/presigned");
    expect(presigned.status).toBe(200);
    expect(storage.presigned).toEqual(["demo/hello"]);
  });

  it("reports a missing demo object as not found", async () => {
    const reply = await call(memoryStorage(), caller("admin-1", true), "GET", "/storage/missing");
    expect(reply).toEqual({ status: 404, body: { code: "STORAGE_OBJECT_NOT_FOUND" } });
  });

  it("rejects keys that would leave the demo prefix", async () => {
    const storage = memoryStorage();
    const admin = caller("admin-1", true);

    for (const key of ["site%2Ffavicon", "profile-images%2Fa.png", "..%2Fsite%2Ffavicon", ".podokit", "%2E%2E"]) {
      const reply = await call(storage, admin, "PUT", `/storage/${key}`, "x");
      expect([400, 404]).toContain(reply.status);
    }
    expect(storage.objects.size).toBe(0);
  });
});
