import { afterEach, describe, expect, it, vi } from "vitest";
import { proxyRequest, resolveClientIp } from "./backend-proxy";

describe("backend proxy client address handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the normalized address from a trusted proxy chain", () => {
    expect(resolveClientIp(() => "::ffff:203.0.113.9")).toBe("203.0.113.9");
  });

  it("omits the address when the proxy header is absent", () => {
    expect(
      resolveClientIp(() => {
        throw new Error("address header is absent");
      }),
    ).toBeUndefined();
  });

  it("omits the address when the proxy chain is too short", () => {
    expect(
      resolveClientIp(() => {
        throw new Error("configured depth exceeds address count");
      }),
    ).toBeUndefined();
  });

  it("does not trust an incoming forwarded header as a fallback", async () => {
    let upstreamHeaders: Headers | undefined;
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      upstreamHeaders = new Headers(init?.headers);
      return new Response(null, { status: 204 });
    });

    const request = new Request("http://app.localhost/api/health", {
      headers: { "x-forwarded-for": "198.51.100.25" },
    });
    const response = await proxyRequest(request, "http://api:5002/health");

    expect(response.status).toBe(204);
    expect(upstreamHeaders?.get("x-forwarded-for")).toBeNull();
  });

  it("forwards a resolved client address", async () => {
    let upstreamHeaders: Headers | undefined;
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      upstreamHeaders = new Headers(init?.headers);
      return new Response(null, { status: 204 });
    });

    const request = new Request("http://app.localhost/api/health");
    const response = await proxyRequest(request, "http://api:5002/health", "203.0.113.9");

    expect(response.status).toBe(204);
    expect(upstreamHeaders?.get("x-forwarded-for")).toBe("203.0.113.9");
  });
});
