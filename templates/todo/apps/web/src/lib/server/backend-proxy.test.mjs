import assert from "node:assert/strict";
import test from "node:test";
import { proxyRequest, resolveClientIp } from "./backend-proxy.ts";

test("resolveClientIp returns the normalized address from a trusted proxy chain", () => {
  assert.equal(resolveClientIp(() => "::ffff:203.0.113.9"), "203.0.113.9");
});

test("resolveClientIp omits the address when the proxy header is absent", () => {
  assert.equal(
    resolveClientIp(() => {
      throw new Error("address header is absent");
    }),
    undefined,
  );
});

test("resolveClientIp omits the address when the proxy chain is too short", () => {
  assert.equal(
    resolveClientIp(() => {
      throw new Error("configured depth exceeds address count");
    }),
    undefined,
  );
});

test("proxyRequest does not trust an incoming forwarded header as a fallback", async (t) => {
  let upstreamHeaders;
  t.mock.method(globalThis, "fetch", async (_input, init) => {
    upstreamHeaders = new Headers(init?.headers);
    return new Response(null, { status: 204 });
  });

  const request = new Request("http://app.localhost/api/health", {
    headers: { "x-forwarded-for": "198.51.100.25" },
  });
  const response = await proxyRequest(request, "http://api:5002/health");

  assert.equal(response.status, 204);
  assert.equal(upstreamHeaders?.get("x-forwarded-for"), null);
});

test("proxyRequest forwards a resolved client address", async (t) => {
  let upstreamHeaders;
  t.mock.method(globalThis, "fetch", async (_input, init) => {
    upstreamHeaders = new Headers(init?.headers);
    return new Response(null, { status: 204 });
  });

  const request = new Request("http://app.localhost/api/health");
  const response = await proxyRequest(request, "http://api:5002/health", "203.0.113.9");

  assert.equal(response.status, 204);
  assert.equal(upstreamHeaders?.get("x-forwarded-for"), "203.0.113.9");
});
