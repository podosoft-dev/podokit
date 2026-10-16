---
"@podosoft/podokit": patch
---

Keep the built web server from closing proxied requests before the `/api` proxy's deadline. The web image, `.env.example`, reference Kubernetes config, and the Compose and Kubernetes deployment renders set adapter-bun's `CONNECTION_IDLE_TIMEOUT` to 35 seconds instead of Bun's default of 10, which cut a request whose API answer took longer with an empty reply after 8 to 12 seconds. The renderers derive the value from the profile's `BACKEND_PROXY_TIMEOUT_MS` unless `runtimeConfig` sets it, and the proxy refuses to load when a set value is not more than 4 seconds above `BACKEND_PROXY_TIMEOUT_MS` and every `APP_PROXY_TIMEOUTS` entry, or `0`, since Bun checks idle connections every 4 seconds.
