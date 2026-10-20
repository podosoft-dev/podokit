---
"@podosoft/podokit": minor
---

Docker Compose deployments always run the internal gateway on the published port, so web is replaced side by side like the API. A profile without WebSocket or API paths and without trusted proxy CIDRs gets a transparent gateway that appends its peer to X-Forwarded-For, and the web server counts it as one more hop, so recorded client addresses stay the same. The first apply on an existing deployment moves the port from web to the gateway once, and a rollback to a revision applied before that is refused.
