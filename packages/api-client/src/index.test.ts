import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  PROFILE_IMAGE_POLICY,
  PUBLIC_SIGNUP_DISABLED,
  SIGNUP_APPROVAL_REQUIRED,
  createApiClient,
} from "./index";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createApiClient", () => {
  it("exports the pending sign-up approval error code", () => {
    expect(SIGNUP_APPROVAL_REQUIRED).toBe("SIGNUP_APPROVAL_REQUIRED");
  });
  it("exports the closed public sign-up error code", () => {
    expect(PUBLIC_SIGNUP_DISABLED).toBe("PUBLIC_SIGNUP_DISABLED");
  });
  it("re-exports the profile-image policy", () => {
    expect(PROFILE_IMAGE_POLICY.maxBytes).toBe(2_097_152);
  });
  it("builds request URLs from baseUrl + apiBasePath", async () => {
    const fetch = vi.fn(async () => jsonResponse({ ok: true }));
    const client = createApiClient({ baseUrl: "http://api.test", fetch });
    await client.get("/todos");
    expect(fetch).toHaveBeenCalledWith(
      "http://api.test/api/todos",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });

  it("returns parsed data on success", async () => {
    const fetch = vi.fn(async () => jsonResponse([{ id: "1" }]));
    const client = createApiClient({ fetch });
    const todos = await client.get<{ id: string }[]>("/todos");
    expect(todos).toEqual([{ id: "1" }]);
  });

  it("sends a JSON body for post", async () => {
    const fetch = vi.fn(async () => jsonResponse({ id: "1" }, 201));
    const client = createApiClient({ fetch });
    await client.post("/todos", { title: "hi" });
    const [, init] = fetch.mock.calls[0]!;
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ title: "hi" }));
    expect((init?.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("sends FormData without overriding its content type", async () => {
    const fetch = vi.fn(async () => jsonResponse({ image: "/api/profile-images/example.png" }, 201));
    const client = createApiClient({ fetch });
    const form = new FormData();
    form.set("file", new Blob(["image"], { type: "image/png" }), "avatar.png");
    await client.postForm("/account/profile-image", form);
    const [, init] = fetch.mock.calls[0]!;
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(form);
    expect(init?.headers).toBeUndefined();
    expect(init?.credentials).toBe("include");
  });

  it("sends Blob, ArrayBuffer, and Uint8Array bodies as they are with a content type", async () => {
    const fetch = vi.fn(async () => jsonResponse({ ok: true }));
    const client = createApiClient({ fetch });
    const blob = new Blob(["chunk"], { type: "video/mp4" });
    const buffer = new ArrayBuffer(4);
    const bytes = new Uint8Array([1, 2, 3]);

    await client.put("/uploads/1/parts/1", blob);
    await client.put("/uploads/1/parts/2", buffer, { contentType: "application/x-chunk" });
    await client.post("/uploads/1/parts/3", bytes, { headers: { "content-range": "bytes 0-2/3" } });
    await client.put("/uploads/1/parts/4", new Blob(["untyped"]));

    const sent = fetch.mock.calls.map(([, init]) => ({
      body: init?.body,
      headers: init?.headers as Record<string, string>,
      duplex: (init as { duplex?: string } | undefined)?.duplex,
    }));
    expect(sent[0]).toEqual({ body: blob, headers: { "content-type": "video/mp4" }, duplex: undefined });
    expect(sent[1]).toEqual({ body: buffer, headers: { "content-type": "application/x-chunk" }, duplex: undefined });
    expect(sent[2]).toEqual({
      body: bytes,
      headers: { "content-type": "application/octet-stream", "content-range": "bytes 0-2/3" },
      duplex: undefined,
    });
    expect(sent[3]?.headers).toEqual({ "content-type": "application/octet-stream" });
  });

  it("streams a ReadableStream body with half-duplex fetch", async () => {
    const fetch = vi.fn(async () => jsonResponse({ ok: true }));
    const client = createApiClient({ fetch });
    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    });
    const controller = new AbortController();
    await client.put("/uploads/1/content", stream, { contentType: "application/octet-stream", signal: controller.signal });
    const [, init] = fetch.mock.calls[0]!;
    expect(init?.body).toBe(stream);
    expect((init as { duplex?: string }).duplex).toBe("half");
    expect(init?.signal).toBe(controller.signal);
    expect((init?.headers as Record<string, string>)["content-type"]).toBe("application/octet-stream");
  });

  it("keeps JSON for plain values and lets the caller name the JSON type", async () => {
    const fetch = vi.fn(async () => jsonResponse({ ok: true }));
    const client = createApiClient({ fetch });
    await client.patch("/todos/1", { done: true }, { contentType: "application/merge-patch+json" });
    await client.del("/todos/1", { headers: { "if-match": "\"v1\"" } });
    const [[, patch], [, del]] = fetch.mock.calls;
    expect(patch?.body).toBe(JSON.stringify({ done: true }));
    expect((patch?.headers as Record<string, string>)["content-type"]).toBe("application/merge-patch+json");
    expect(del?.body).toBeUndefined();
    expect(del?.headers).toEqual({ "if-match": "\"v1\"" });
  });

  it("reports Retry-After on errors in seconds", async () => {
    const limited = vi.fn(async () =>
      new Response(
        JSON.stringify({ success: false, error: { code: "RATE_LIMIT_EXCEEDED", message: "Too many requests.", statusCode: 429 } }),
        { status: 429, headers: { "retry-after": "7" } },
      ),
    );
    await expect(createApiClient({ fetch: limited }).get("/x")).rejects.toMatchObject({
      code: "RATE_LIMIT_EXCEEDED",
      statusCode: 429,
      retryAfterSeconds: 7,
    });

    const at = new Date(Date.now() + 30_000).toUTCString();
    const unavailable = vi.fn(async () => new Response("", { status: 503, headers: { "retry-after": at } }));
    const error = await createApiClient({ fetch: unavailable }).get("/x").catch((e: unknown) => e);
    expect((error as ApiError).retryAfterSeconds).toBeGreaterThanOrEqual(29);
    expect((error as ApiError).retryAfterSeconds).toBeLessThanOrEqual(30);

    const plain = vi.fn(async () => new Response("", { status: 500 }));
    const failure = await createApiClient({ fetch: plain }).get("/x").catch((e: unknown) => e);
    expect((failure as ApiError).retryAfterSeconds).toBeUndefined();
  });

  it("throws ApiError parsed from the standard error envelope", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(
        { success: false, error: { code: "NOT_FOUND", message: "Missing", statusCode: 404 } },
        404,
      ),
    );
    const client = createApiClient({ fetch });
    await expect(client.get("/todos/x")).rejects.toMatchObject({
      name: "ApiError",
      code: "NOT_FOUND",
      message: "Missing",
      statusCode: 404,
    });
  });

  it("falls back to HTTP_ERROR when there is no envelope", async () => {
    const fetch = vi.fn(async () => new Response("", { status: 500, statusText: "Server Error" }));
    const client = createApiClient({ fetch });
    const error = await client.get("/boom").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).statusCode).toBe(500);
    expect((error as ApiError).code).toBe("HTTP_ERROR");
  });

  it("reports a non-JSON error body, such as a proxy's page, as ApiError", async () => {
    const fetch = vi.fn(async () =>
      new Response("<html>Bad Gateway</html>", {
        status: 502,
        statusText: "Bad Gateway",
        headers: { "content-type": "text/html", "retry-after": "3" },
      }),
    );
    const error = await createApiClient({ fetch }).put("/files/uploads/u1/parts/1", new Blob(["x"])).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "HTTP_ERROR", statusCode: 502, message: "Bad Gateway", retryAfterSeconds: 3 });

    const tooLarge = vi.fn(async () => new Response("Payload Too Large", { status: 413 }));
    await expect(createApiClient({ fetch: tooLarge }).post("/x", {})).rejects.toMatchObject({ statusCode: 413 });
  });

  it("exposes the better-auth client with the admin plugin", () => {
    const client = createApiClient({ baseUrl: "http://api.test" });
    expect(typeof client.auth.signIn.email).toBe("function");
    expect(typeof client.auth.admin.listUsers).toBe("function");
  });
});
