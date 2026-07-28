import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createUpgradeProxy, decideUpgrade, upstreamHeaders } from "./ws-upgrade.js";

const allowed = new Set(["/events/ws"]);
const handshake = { upgrade: "websocket", connection: "Upgrade", host: "app.example.com" };

describe("decideUpgrade", () => {
  it("forwards an allowed path", () => {
    expect(decideUpgrade("/events/ws", handshake, allowed)).toEqual({
      kind: "proxy",
      path: "/events/ws",
    });
  });

  it("keeps the query string", () => {
    expect(decideUpgrade("/events/ws?room=1", handshake, allowed)).toEqual({
      kind: "proxy",
      path: "/events/ws?room=1",
    });
  });

  it.each([
    ["/events/wsx", "a path that only starts the same"],
    ["/events/ws/", "a trailing slash"],
    ["/admin/secrets", "an unrelated path"],
    ["/events/../admin/secrets", "traversal that resolves elsewhere"],
    ["//evil.example.com/events/ws", "a protocol-relative target"],
    ["http://evil.example.com/events/ws", "an absolute target"],
  ])("rejects %s (%s)", (url) => {
    expect(decideUpgrade(url, handshake, allowed).kind).toBe("reject");
  });

  it("rejects a request that is not a websocket upgrade", () => {
    expect(decideUpgrade("/events/ws", { ...handshake, upgrade: "h2c" }, allowed).kind).toBe(
      "reject",
    );
  });

  it("forwards nothing when no path is configured", () => {
    expect(decideUpgrade("/events/ws", handshake, new Set()).kind).toBe("reject");
  });
});

describe("upstreamHeaders", () => {
  it("passes the handshake and cookie through", () => {
    const headers = upstreamHeaders(
      { ...handshake, cookie: "session=abc", "sec-websocket-key": "k" },
      {},
    );
    expect(headers.cookie).toBe("session=abc");
    expect(headers["sec-websocket-key"]).toBe("k");
    expect(headers.upgrade).toBe("websocket");
  });

  it("appends to an existing forwarded chain rather than replacing it", () => {
    const headers = upstreamHeaders(
      { ...handshake, "x-forwarded-for": "203.0.113.7" },
      { remoteAddress: "::ffff:10.0.0.2" },
    );
    expect(headers["x-forwarded-for"]).toBe("203.0.113.7, 10.0.0.2");
  });

  it("reports the scheme the client actually used", () => {
    expect(upstreamHeaders(handshake, { encrypted: true })["x-forwarded-proto"]).toBe("https");
    expect(upstreamHeaders(handshake, {})["x-forwarded-proto"]).toBe("http");
  });
});

describe("createUpgradeProxy", () => {
  function socket() {
    const stream = new PassThrough();
    stream.destroy = () => {
      stream.destroyed = true;
      return stream;
    };
    return stream;
  }

  it("destroys a rejected upgrade without contacting the API", () => {
    let called = false;
    const proxy = createUpgradeProxy({ allowed, connect: () => ((called = true), { abort() {} }) });
    const client = socket();
    proxy({ url: "/admin/secrets", headers: handshake }, client, null);
    expect(called).toBe(false);
    expect(client.destroyed).toBe(true);
  });

  it("relays the API's refusal instead of dropping the socket", () => {
    const proxy = createUpgradeProxy({
      allowed,
      connect: (_options, hooks) => {
        hooks.onResponse(401, "Unauthorized", { "content-length": "0" });
        return { abort() {} };
      },
    });
    const client = socket();
    /** @type {string[]} */
    const written = [];
    client.on("data", (chunk) => written.push(chunk.toString()));
    proxy({ url: "/events/ws", headers: handshake }, client, null);
    expect(written.join("")).toContain("HTTP/1.1 401 Unauthorized");
  });

  it("answers 502 when the API cannot be reached", () => {
    const proxy = createUpgradeProxy({
      allowed,
      connect: (_options, hooks) => (hooks.onError("ECONNREFUSED"), { abort() {} }),
    });
    const client = socket();
    /** @type {string[]} */
    const written = [];
    client.on("data", (chunk) => written.push(chunk.toString()));
    proxy({ url: "/events/ws", headers: handshake }, client, null);
    expect(written.join("")).toContain("HTTP/1.1 502 Bad Gateway");
  });

  it("writes the 101 and pipes both directions once upstream upgrades", () => {
    const upstream = socket();
    const proxy = createUpgradeProxy({
      allowed,
      connect: (_options, hooks) => {
        hooks.onUpgrade(101, { upgrade: "websocket" }, upstream, null);
        return { abort() {} };
      },
    });
    const client = socket();
    /** @type {string[]} */
    const written = [];
    client.on("data", (chunk) => written.push(chunk.toString()));
    proxy({ url: "/events/ws", headers: handshake }, client, null);
    expect(written.join("")).toContain("HTTP/1.1 101 Switching Protocols");
  });
});
