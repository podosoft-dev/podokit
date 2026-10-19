---
"@podosoft/podokit": patch
---

Stop the shared dev gateway from answering 404 for a project for minutes after its dev stack restarts. A request that reached the project's new gateway link before the link loaded its TCP forwards was answered by the link itself with 404, and Traefik keeps serving such a connection as HTTP for its whole life, so the gateway's pooled connection returned 404 until the gateway restarted. The link now closes every connection it answers itself after one response (`transport.keepAliveMaxRequests=1` on its entry points), so the gateway dials a new connection that is passed through. Compose recreates the link once on the next `podo dev watch` or `podo dev up`; apps need no change.
