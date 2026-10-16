import type { ApiServerOptionsSource } from "./config/server-options";
import type { PodokitModule, ServiceRegistry } from "./core/services";

// This owned extension slot is never overwritten by `podo update`. Register
// application services during startup and add Elysia plugins without editing
// managed PodoKit files. The registry is frozen before the server starts, so
// service resolution never occurs on the request hot path.

export function configureServices(_services: ServiceRegistry): void {}

export const extensionModules: PodokitModule[] = [];

// Bun server options such as a larger request body limit for uploads, for
// example { maxRequestBodySize: 1024 ** 3, idleTimeout: 120 }. Values set here
// win over API_MAX_REQUEST_BODY_SIZE; a function receives the validated
// environment instead: (env) => ({ maxRequestBodySize: ... }). A longer
// idleTimeout also needs BACKEND_PROXY_TIMEOUT_MS on the web server, which stops
// waiting for response headers after 30 seconds by default.
export const apiServerOptions: ApiServerOptionsSource = {};
