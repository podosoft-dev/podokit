---
"@podosoft/podokit": minor
"@podosoft/podokit-mcp": minor
---

Add `podo deploy sync` and a release workflow for generated projects.

`podo deploy sync` copies a project's build output into the containers a Compose
deployment is already running and restarts them, so iterating against a deployment
does not need a full image round trip. It is deliberately not a release: the image
tag is unchanged, a marker records the drift, `podo deploy status` reports it as
`syncDrift`, and the next apply discards it. It refuses when runtime dependencies
have changed, when a release holds the lock, or when a restarted container does not
become healthy, and it never runs migrations. A profile can name build outputs to
leave alone with `sync.exclude`.

Generated projects now ship `.github/workflows/release.yml`, which builds and pushes
both images on a `vX.Y.Z` tag. Its runner is a variable rather than a constant,
because GitHub-hosted minutes are free only for public repositories and image builds
are the most expensive job most projects run.
