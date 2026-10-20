---
"@podosoft/podokit": minor
---

Docker Compose profiles accept more than one web replica, since the gateway now holds the published port. The gateway resolves the web and API service names as dynamic upstreams and balances per request, retrying a container that stopped since the last lookup on another one.
