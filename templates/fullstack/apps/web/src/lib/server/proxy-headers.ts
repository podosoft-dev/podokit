/**
 * Application-owned header names that the managed /api proxy (backend-proxy.ts)
 * passes through in addition to its built-in lists. Names are case-insensitive.
 * Request headers listed here are forwarded from the browser to the API, such as
 * "x-api-key" for machine clients; response headers are relayed from the API to
 * the browser, such as "x-checksum-sha256". The proxy handles hop-by-hop headers,
 * host, content-length, content-encoding, set-cookie, and the forwarding headers
 * that carry the client address itself, so a listed one fails the build.
 * PodoKit creates this file once and never overwrites it.
 */
export const APP_FORWARDED_REQUEST_HEADERS: readonly string[] = [];
export const APP_RELAYED_RESPONSE_HEADERS: readonly string[] = [];
