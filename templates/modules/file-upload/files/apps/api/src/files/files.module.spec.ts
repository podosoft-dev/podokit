import { describe, expect, it } from "bun:test";
import { AppException } from "@podosoft/podokit-contracts";
import type { ObjectBody, ObjectData, ObjectStore } from "@podosoft/podokit-runtime";
import { Elysia } from "elysia";
import type { RequestIdentity } from "../core/services";
import { filesRoutes } from "./files.module";

async function bytes(body: ObjectBody): Promise<Uint8Array> {
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof Uint8Array) return body;
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function* single(value: Uint8Array): AsyncGenerator<Uint8Array> {
  yield value;
}

function memoryStore(): ObjectStore {
  const objects = new Map<string, Uint8Array>();
  return {
    put: async (key, body, options) => {
      const value = await bytes(body);
      objects.set(key, value);
      return { key, size: value.byteLength, ...options };
    },
    get: async (key): Promise<ObjectData> => {
      const value = objects.get(key);
      if (!value) throw new Error("missing");
      return { key, size: value.byteLength, body: single(value) };
    },
    exists: async (key) => objects.has(key),
    delete: async (key) => {
      objects.delete(key);
    },
    getDownloadUrl: async (key) => `https://storage.example.com/${key}`,
    close: () => undefined,
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

async function send(store: ObjectStore, identity: RequestIdentity, request: Request): Promise<Reply> {
  const app = new Elysia()
    .onError(({ error, set }) => {
      if (!(error instanceof AppException)) return undefined;
      set.status = error.statusCode;
      return { code: error.code };
    })
    .use(filesRoutes(store, identity));
  const response = await app.handle(request);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function upload(store: ObjectStore, identity: RequestIdentity): Promise<string> {
  const form = new FormData();
  form.append("file", new File(["hello"], "hello.txt", { type: "text/plain" }));
  const reply = await send(store, identity, new Request("http://localhost/files", {
    method: "POST",
    body: form,
  }));
  expect(reply.status).toBe(201);
  return String(reply.body.key);
}

function presign(store: ObjectStore, identity: RequestIdentity, key: string): Promise<Reply> {
  return send(store, identity, new Request(`http://localhost/files/${encodeURIComponent(key)}/url`));
}

describe("file upload routes", () => {
  it("stores uploads under the uploader and presigns them for the owner", async () => {
    const store = memoryStore();
    const key = await upload(store, caller("user_1"));

    expect(key).toMatch(/^uploads\/user_1\/[0-9a-f-]{36}-hello\.txt$/);
    expect(await presign(store, caller("user_1"), key)).toEqual({
      status: 200,
      body: { url: `https://storage.example.com/${key}` },
    });
  });

  it("refuses another user's upload but lets an administrator presign it", async () => {
    const store = memoryStore();
    const key = await upload(store, caller("user_1"));

    expect(await presign(store, caller("user_2"), key)).toEqual({
      status: 403,
      body: { code: "FILE_FORBIDDEN" },
    });
    expect((await presign(store, caller("admin_1", true), key)).status).toBe(200);
  });

  it("does not presign keys outside uploads", async () => {
    const store = memoryStore();
    for (const key of ["site/favicon", "profile-images/a.png", "demo/hello"]) {
      expect(await presign(store, caller("admin_1", true), key)).toEqual({
        status: 404,
        body: { code: "FILE_NOT_FOUND" },
      });
    }
  });

  it("treats uploads from before ownership as administrator-only", async () => {
    const store = memoryStore();
    const legacy = "uploads/0b5f6b7e-8c1d-4d6e-9f00-112233445566-old.txt";

    expect((await presign(store, caller("user_1"), legacy)).status).toBe(403);
    expect((await presign(store, caller("admin_1", true), legacy)).status).toBe(200);
  });
});
