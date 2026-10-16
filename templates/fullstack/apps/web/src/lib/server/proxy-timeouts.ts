/**
 * Application-owned deadlines for /api requests that the web server proxies to
 * the API. An entry replaces BACKEND_PROXY_TIMEOUT_MS for every request whose
 * path is pathPrefix or below it, for example
 *   { pathPrefix: "/api/exports/", timeoutMs: 120_000 }
 * and the longest matching prefix wins. timeoutMs is how long the proxy waits
 * for the API's response headers before it answers 504 BACKEND_TIMEOUT; null
 * waits as long as the API takes. Either way the proxy answers 503
 * BACKEND_UNAVAILABLE once the API's GET /health stops answering, and the
 * deadline ends when the response headers arrive.
 *
 * Bun closes a silent connection up to 4 seconds before its idle timeout, so a
 * longer wait also needs the API's apiServerOptions.idleTimeout and the web
 * server's CONNECTION_IDLE_TIMEOUT (35 seconds by default) more than 4 seconds
 * above the deadline, or 0 for null or anything above 250 seconds. The proxy
 * refuses to load when CONNECTION_IDLE_TIMEOUT cannot cover an entry here.
 * PodoKit creates this file once and never overwrites it.
 */
export const APP_PROXY_TIMEOUTS: ReadonlyArray<{ pathPrefix: string; timeoutMs: number | null }> = [];
