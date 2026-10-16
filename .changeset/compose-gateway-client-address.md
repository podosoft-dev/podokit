---
"@podosoft/podokit": patch
---

Send web and API one client address from the Compose deployment gateway. Behind a proxy listed in `exposure.trustedProxyCidrs`, Caddy appended that proxy to `X-Forwarded-For`, so with `XFF_DEPTH=1` and `TRUSTED_PROXY_HOPS=1` web and API recorded the proxy's address for sessions, audit entries, and rate limits. Every gateway `reverse_proxy` now sets `header_up X-Forwarded-For {client_ip}`: the client behind a trusted proxy, the gateway's peer otherwise.
