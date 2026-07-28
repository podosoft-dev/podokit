---
"@podosoft/podokit": minor
"@podosoft/podokit-mcp": minor
---

Add a `docker-compose` deployment driver alongside `kubernetes-helm`, and fix the
production images.

`podo deploy` now operates a Compose project on one Docker host — local or over
`ssh://` — with the same contract the Kubernetes driver has: a fingerprinted target,
image tags resolved to digests, a confirmation hash that apply must echo back, a
release-scoped lock, an exact-image migration before rollout, public verification, and
rollback. A profile declares its own `driver`, so every command after `init` reads it
from the profile, and the MCP tools follow it too.

The production Dockerfiles were only buildable for the template's own three
workspaces. They now collect every workspace manifest, carry the whole install output
into the build, compile local `packages/*` before the app that imports them, install
the npm major that wrote the lockfile, prune the runtime tree, declare a healthcheck,
and keep `.env` out of the build context.
