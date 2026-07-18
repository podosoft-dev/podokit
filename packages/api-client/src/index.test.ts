import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
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

  it("exposes the better-auth client with the admin plugin", () => {
    const client = createApiClient({ baseUrl: "http://api.test" });
    expect(typeof client.auth.signIn.email).toBe("function");
    expect(typeof client.auth.admin.listUsers).toBe("function");
  });
});
