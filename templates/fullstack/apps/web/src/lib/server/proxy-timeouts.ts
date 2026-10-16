/**
 * Application-owned deadlines for /api requests that the web server proxies to
 * the API. An entry replaces BACKEND_PROXY_TIMEOUT_MS for every request whose
 * path is pathPrefix or below it, for example
 *   { pathPrefix: "/api/exports/", timeoutMs: 120_000 }
 * and the longest matching prefix wins. timeoutMs is how long the proxy waits
 * for the API's response headers before it answers 504 BACKEND_TIMEOUT; null
 * waits as long as the API takes. Either way the proxy answers 503
 * BACKEND_UNAVAILABLE once the API's GET /health stops answering, and a
 * response body is never cut off once its headers arrive.
 *
 * A longer wait also needs the API to keep the connection open that long (its
 * apiServerOptions.idleTimeout) and the web server's CONNECTION_IDLE_TIMEOUT.
 * PodoKit creates this file once and never overwrites it.
 */
export const APP_PROXY_TIMEOUTS: ReadonlyArray<{ pathPrefix: string; timeoutMs: number | null }> = [];
