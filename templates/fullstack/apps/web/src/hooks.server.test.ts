import type { RequestEvent } from "@sveltejs/kit";
import { describe, expect, it, vi } from "vitest";
import { handle } from "./hooks.server";

vi.mock("$app/env", () => ({ dev: false }));

const resolve = vi.fn(async (_event: RequestEvent): Promise<Response> => new Response("ok"));

function post(path: string, headers: Record<string, string>): RequestEvent {
  const url = new URL(path, "https://app.example.com");
  return { request: new Request(url, { method: "POST", headers }), url } as RequestEvent;
}

describe("handle", () => {
  it("refuses a cross-site form submission before any route runs", async () => {
    const response = await handle({ event: post("/", { origin: "https://cross-site.example" }), resolve });

    expect(response.status).toBe(403);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("passes an /api request without an Origin header to the proxy route", async () => {
    const event = post("/api/items", {});

    const response = await handle({ event, resolve });

    expect(await response.text()).toBe("ok");
    expect(resolve).toHaveBeenCalledWith(event);
  });
});
