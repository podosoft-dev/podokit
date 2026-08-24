/**
 * WebSocket upgrades, proxied by the web server itself.
 *
 * WHY THIS EXISTS: a SvelteKit server route cannot serve a WebSocket upgrade.
 * `+server.ts` handlers answer HTTP requests and never see an `upgrade` event, and
 * the `/api/*` proxy is HTTP-only for the same reason — `fetch` cannot carry a 101.
 * Meanwhile a deployment routes all public traffic to the web app, so an API
 * WebSocket gateway has no path to reach at all. Development hides this, because
 * Vite proxies upgrades; the feature then dies silently once deployed.
 *
 * ⚠ NOTHING IS FORWARDED BY DEFAULT. `WS_PROXY_PATHS` names the exact paths that may
 * upgrade, comma-separated, and anything else is destroyed rather than proxied. A
 * relay that forwards any path is an open tunnel to every private route on the API,
 * reachable from the public origin without a session. Adding a path is a security
 * decision, not a routing tweak — the API must authorise that socket at handshake
 * time, from the session cookie or its own credential.
 *
 * This file is plain JavaScript on purpose: `server.js` imports `./build/`, which
 * only exists after a build, so the entry point cannot be type-checked. Everything
 * with a decision in it lives here, where it is unit-tested.
 */
import http from "node:http";
import https from "node:https";

/** @typedef {Record<string, string | string[] | undefined>} Headers */
/** @typedef {{ kind: "proxy", path: string } | { kind: "reject", reason: string }} UpgradeDecision */

/**
 * The upgrade paths this deployment allows, matched whole — never as a prefix, a
 * wildcard, or a pattern.
 *
 * @returns {ReadonlySet<string>}
 */
export function relayPaths() {
  return new Set(
    (process.env.WS_PROXY_PATHS ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.startsWith("/")),
  );
}

/** Where upgrades are sent. Same target the HTTP proxy uses. */
export function backendBaseUrl() {
  return process.env.BACKEND_INTERNAL_URL ?? "http://localhost:5002";
}

/**
 * Normalize a client address for the forwarded header: map loopback to a clean IPv4
 * value and unwrap IPv4-mapped addresses.
 *
 * @param {string | undefined} address
 * @returns {string | undefined}
 */
export function normalizeClientIp(address) {
  if (!address) return undefined;
  if (address === "::1" || address === "::") return "127.0.0.1";
  if (address.startsWith("::ffff:")) return address.slice("::ffff:".length);
  return address;
}

/**
 * Should this upgrade be forwarded, and under which normalized path?
 *
 * The path is re-serialised from `URL` rather than echoed, so a target that only
 * looks like an allowed path after resolving `..` cannot reach anything else. A
 * request target carrying its own authority is refused outright.
 *
 * @param {string | undefined} url `req.url`, an origin-form request target
 * @param {Headers} headers
 * @param {ReadonlySet<string>} [allowed]
 * @returns {UpgradeDecision}
 */
export function decideUpgrade(url, headers, allowed = relayPaths()) {
  const upgrade = String(headers.upgrade ?? "").toLowerCase();
  if (upgrade !== "websocket") return { kind: "reject", reason: "not a websocket upgrade" };
  if (!url || !url.startsWith("/") || url.startsWith("//")) {
    return { kind: "reject", reason: "not an origin-form request target" };
  }
  let parsed;
  try {
    parsed = new URL(url, "http://upgrade.invalid");
  } catch {
    return { kind: "reject", reason: "unparsable request target" };
  }
  if (!allowed.has(parsed.pathname)) return { kind: "reject", reason: "not an allowed upgrade path" };
  return { kind: "proxy", path: `${parsed.pathname}${parsed.search}` };
}

/**
 * What the API is told about the request.
 *
 * Handshake headers and the session cookie pass through untouched — the API
 * authorises the socket from them, so dropping either turns every connection into a
 * 401. The `x-forwarded-*` trio is appended rather than replaced: behind another
 * proxy this server is one hop in a chain, and overwriting it reports the wrong
 * client upstream.
 *
 * @param {Headers} headers
 * @param {{ remoteAddress?: string, encrypted?: boolean }} socket
 * @returns {Headers}
 */
export function upstreamHeaders(headers, socket) {
  /** @type {Headers} */
  const forwarded = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (name === "x-forwarded-for" || name === "x-forwarded-proto" || name === "x-forwarded-host") {
      continue;
    }
    forwarded[name] = value;
  }

  const client = normalizeClientIp(socket.remoteAddress);
  const chain = [headers["x-forwarded-for"], client]
    .flat()
    .filter((entry) => typeof entry === "string" && entry.length > 0);
  if (chain.length > 0) forwarded["x-forwarded-for"] = chain.join(", ");

  forwarded["x-forwarded-proto"] = headers["x-forwarded-proto"] ?? (socket.encrypted ? "https" : "http");
  const host = headers["x-forwarded-host"] ?? headers.host;
  if (host !== undefined) forwarded["x-forwarded-host"] = host;

  return forwarded;
}

/**
 * @param {string} path
 * @param {Headers} headers
 */
export function upstreamOptions(path, headers) {
  const base = new URL(backendBaseUrl());
  return {
    protocol: base.protocol,
    hostname: base.hostname,
    port: base.port || (base.protocol === "https:" ? "443" : "80"),
    path,
    headers,
  };
}

/**
 * @param {string} statusLine
 * @param {Headers} headers
 * @returns {string}
 */
function rawHead(statusLine, headers) {
  const lines = [statusLine];
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const item of value) lines.push(`${name}: ${item}`);
    else lines.push(`${name}: ${value}`);
  }
  return `${lines.join("\r\n")}\r\n\r\n`;
}

/**
 * Streaming sockets carry many small frames, so Nagle's algorithm adds latency to
 * every one, and the default timeout would cut an idle-but-attached connection.
 *
 * @param {{ setTimeout?: Function, setNoDelay?: Function, setKeepAlive?: Function }} socket
 */
function tune(socket) {
  socket.setTimeout?.(0);
  socket.setNoDelay?.(true);
  socket.setKeepAlive?.(true, 0);
}

/** The real transport: one upstream HTTP request carrying the upgrade. */
const nodeConnect = (options, hooks) => {
  const transport = options.protocol === "https:" ? https : http;
  const upstream = transport.request({
    protocol: options.protocol,
    hostname: options.hostname,
    port: options.port,
    path: options.path,
    method: "GET",
    headers: options.headers,
  });
  upstream.on("upgrade", (response, socket, head) => {
    hooks.onUpgrade(response.statusCode ?? 101, response.headers, socket, head);
  });
  upstream.on("response", (response) => {
    hooks.onResponse(response.statusCode ?? 502, response.statusMessage ?? "", response.headers);
    response.resume(); // Drain, or the socket is never released.
  });
  upstream.on("error", (error) => hooks.onError(error.message));
  upstream.end();
  return { abort: () => upstream.destroy() };
};

/**
 * @typedef {object} UpstreamHooks
 * @property {(status: number, headers: Headers, socket: any, head: Uint8Array | null) => void} onUpgrade
 * @property {(status: number, statusMessage: string, headers: Headers) => void} onResponse
 * @property {(reason: string) => void} onError
 */

/** @typedef {(options: ReturnType<typeof upstreamOptions>, hooks: UpstreamHooks) => { abort: () => void }} Connect */

/**
 * Build the `upgrade` listener the built server mounts.
 *
 * The transport is injected so the decisions here are testable without a socket.
 *
 * @param {{ connect?: Connect, allowed?: ReadonlySet<string> }} [options]
 */
export function createUpgradeProxy(options = {}) {
  const connect = options.connect ?? nodeConnect;
  const allowed = options.allowed ?? relayPaths();

  return function onUpgrade(request, socket, head) {
    const decision = decideUpgrade(request.url, request.headers, allowed);
    if (decision.kind === "reject") {
      socket.destroy();
      return;
    }

    tune(socket);
    // Bytes the client already sent belong to the stream: push them back so the pipe
    // below carries them upstream in order.
    if (head && head.length > 0) socket.unshift(head);

    let clientGone = false;
    const upstream = connect(
      upstreamOptions(decision.path, upstreamHeaders(request.headers, socket)),
      {
        onUpgrade(status, headers, upstreamSocket, upstreamHead) {
          if (clientGone) {
            upstreamSocket.destroy();
            return;
          }
          if (upstreamHead && upstreamHead.length > 0) upstreamSocket.unshift(upstreamHead);
          tune(upstreamSocket);
          socket.write(rawHead(`HTTP/1.1 ${status} Switching Protocols`, headers));
          // A client that hangs forever is worse than one told it lost the relay, so
          // either end closing takes the other down.
          upstreamSocket.on("error", () => socket.destroy());
          upstreamSocket.on("close", () => socket.end());
          upstreamSocket.pipe(socket);
          socket.pipe(upstreamSocket);
        },
        onResponse(status, statusMessage, headers) {
          // The API refused the handshake. Relaying ITS answer is what turns "the
          // socket vanished" into a diagnosable failure in the browser.
          socket.write(
            rawHead(`HTTP/1.1 ${status} ${statusMessage}`.trim(), {
              ...headers,
              connection: "close",
            }),
          );
          socket.end();
        },
        onError() {
          socket.write(rawHead("HTTP/1.1 502 Bad Gateway", { connection: "close" }));
          socket.end();
        },
      },
    );

    socket.on("error", () => upstream.abort());
    socket.on("close", () => {
      clientGone = true;
      upstream.abort();
    });
  };
}
