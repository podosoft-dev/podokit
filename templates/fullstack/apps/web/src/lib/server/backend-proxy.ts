import { APP_FORWARDED_REQUEST_HEADERS, APP_RELAYED_RESPONSE_HEADERS } from "./proxy-headers";

// Server-side proxy boundary. The browser never talks to the API directly:
// requests go through SvelteKit server routes, which forward an allowlist of
// headers to BACKEND_INTERNAL_URL and relay the response (including Set-Cookie).
// Applications add their own header names in the app-owned proxy-headers.ts.
//
// `user-agent` is on the list for the same reason the client IP is forwarded
// below: better-auth records it on the session and the account page shows it as
// the device. Leaving it off does not produce an empty column -- fetch supplies
// its own default, so every session in the database reads "node", and the list
// of "your devices" becomes a list of identical rows that identify nothing.
const FORWARDED_HEADERS = [
  "authorization",
  "cookie",
  "content-type",
  "accept",
  "origin",
  "referer",
  "user-agent",
  "if-none-match",
  "if-modified-since",
  "range",
  "if-range",
];
const RELAYED_RESPONSE_HEADERS = [
  "content-type",
  "content-disposition",
  "content-range",
  "accept-ranges",
  "location",
  "cache-control",
  "etag",
  "last-modified",
  "vary",
  "x-content-type-options",
  "content-security-policy",
  "retry-after",
  "ratelimit-limit",
  "ratelimit-remaining",
  // Cursor-paged lists (such as the audit log) return the next page's cursor here.
  "x-next-cursor",
];

// Hop-by-hop headers describe a single connection, and the proxy sets framing,
// cookies, and the client address itself, so application lists cannot add these.
const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];
const RESERVED_REQUEST_HEADERS = new Set([
  ...HOP_BY_HOP_HEADERS,
  "host",
  "content-length",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-real-ip",
]);
const RESERVED_RESPONSE_HEADERS = new Set([
  ...HOP_BY_HOP_HEADERS,
  "content-length",
  "content-encoding",
  "set-cookie",
]);
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9a-z-]+$/;

/** Append an application's header names to a built-in list, lowercased and
 *  without duplicates. Throws on an invalid or reserved name so a mistake fails
 *  the build instead of silently dropping the header. */
export function withAppHeaders(
  builtIn: readonly string[],
  app: readonly string[],
  reserved: ReadonlySet<string>,
  listName: string,
): string[] {
  const names = new Set(builtIn);
  for (const entry of app) {
    const name = entry.toLowerCase();
    if (!HEADER_NAME.test(name)) {
      throw new Error(`${listName} contains an invalid header name: ${JSON.stringify(entry)}`);
    }
    if (reserved.has(name)) {
      throw new Error(`${listName} cannot contain "${name}": the proxy handles that header itself.`);
    }
    names.add(name);
  }
  return [...names];
}

const forwardedHeaders = withAppHeaders(
  FORWARDED_HEADERS,
  APP_FORWARDED_REQUEST_HEADERS,
  RESERVED_REQUEST_HEADERS,
  "APP_FORWARDED_REQUEST_HEADERS",
);
const relayedResponseHeaders = withAppHeaders(
  RELAYED_RESPONSE_HEADERS,
  APP_RELAYED_RESPONSE_HEADERS,
  RESERVED_RESPONSE_HEADERS,
  "APP_RELAYED_RESPONSE_HEADERS",
);

// SvelteKit decodes rest params, so an encoded "%2F" or "%3F" inside a path
// segment would reach the API as "/" or "?". Forward the raw pathname instead.
export function rawSubpath(url: URL, prefix: string): string {
  return url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : url.pathname;
}

export function backendBaseUrl(): string {
  return process.env.BACKEND_INTERNAL_URL ?? "http://localhost:5002";
}

// Normalize the resolved client IP for the forwarded header. better-auth stores
// IPv4 as-is but anonymizes IPv6 (masks the host bits), so an IPv6 loopback would
// be recorded as "::" — map loopback to 127.0.0.1 for a clean local value, and
// unwrap IPv4-mapped addresses.
export function normalizeClientIp(address: string | undefined): string | undefined {
  if (!address) return undefined;
  if (address === "::1" || address === "::") return "127.0.0.1";
  if (address.startsWith("::ffff:")) return address.slice("::ffff:".length);
  return address;
}

export function resolveClientIp(getClientAddress: () => string): string | undefined {
  try {
    return normalizeClientIp(getClientAddress());
  } catch {
    // An absent or shorter-than-configured proxy chain is not a trusted source.
    return undefined;
  }
}

export async function proxyRequest(
  request: Request,
  targetUrl: string,
  clientAddress?: string,
): Promise<Response> {
  const headers = new Headers();
  for (const name of forwardedHeaders) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Forward the resolved client IP so the API (better-auth) can record it.
  const forwardedIp = normalizeClientIp(clientAddress);
  if (forwardedIp) headers.set("x-forwarded-for", forwardedIp);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await fetch(targetUrl, {
    method: request.method,
    headers,
    // Preserve multipart uploads and other binary bodies byte-for-byte. Reading
    // them as text corrupts bytes that are not valid UTF-8 before forwarding.
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: "manual",
    // Abort the upstream request when the browser disconnects. Without this, every
    // closed EventSource or aborted request keeps its API socket open until Bun's
    // fetch pool is exhausted and the web process stops serving requests.
    signal: request.signal,
  });

  const responseHeaders = new Headers();
  for (const name of relayedResponseHeaders) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  // Bun's fetch decodes a compressed body but keeps the upstream content-encoding
  // and compressed content-length, which would truncate the decoded body.
  const contentLength = upstream.headers.get("content-length");
  if (contentLength && !upstream.headers.has("content-encoding")) {
    responseHeaders.set("content-length", contentLength);
  }
  // Relay Set-Cookie so auth session cookies reach the browser.
  for (const cookie of upstream.headers.getSetCookie()) {
    responseHeaders.append("set-cookie", cookie);
  }

  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
