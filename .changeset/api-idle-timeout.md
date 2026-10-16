---
"@podosoft/podokit": patch
---

Keep the generated API from closing a slow request before the web proxy's deadline. The API's idle timeout defaults to 35 seconds instead of Elysia's 30 and comes from the new `API_IDLE_TIMEOUT` (0 to 255, 0 turns it off), which `apiServerOptions.idleTimeout` still overrides. Bun checks idle connections every 4 seconds, so 30 cut endpoints that answered after 28 to 30 seconds and every longer `APP_PROXY_TIMEOUTS` route. The Compose and Kubernetes renderers derive `API_IDLE_TIMEOUT` from `BACKEND_PROXY_TIMEOUT_MS` like `CONNECTION_IDLE_TIMEOUT`.
