# @podosoft/podokit-mcp

## 0.3.0

### Minor Changes

- [#141](https://github.com/podosoft-dev/podokit/pull/141) [`ecdd80a`](https://github.com/podosoft-dev/podokit/commit/ecdd80a4bd3bb63c18374a49cb5e0327c455ec4f) Thanks [@korone00](https://github.com/korone00)! - Add `podo deploy sync` and a release workflow for generated projects.

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

- [#139](https://github.com/podosoft-dev/podokit/pull/139) [`6561d7d`](https://github.com/podosoft-dev/podokit/commit/6561d7d561d78f7eb7b908694669b61870e97770) Thanks [@korone00](https://github.com/korone00)! - Add a `docker-compose` deployment driver alongside `kubernetes-helm`, and fix the
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

  Generated projects now ship an upgrade-capable web entry point. A SvelteKit route
  cannot answer a WebSocket upgrade, so an API gateway was unreachable once deployed;
  `apps/web/server.js` keeps adapter-node in charge and relays the exact paths named in
  `WS_PROXY_PATHS`, matched whole. Nothing is forwarded by default.

  The example `infra/k3s` manifests no longer contradict the deployment tooling: they
  carry probes, an `ingressClassName`, a TLS block, placeholder tags instead of
  `latest`, and a README saying `podo deploy` renders the manifests it actually applies.

### Patch Changes

- Updated dependencies [[`ecdd80a`](https://github.com/podosoft-dev/podokit/commit/ecdd80a4bd3bb63c18374a49cb5e0327c455ec4f), [`6561d7d`](https://github.com/podosoft-dev/podokit/commit/6561d7d561d78f7eb7b908694669b61870e97770), [`aa06b1d`](https://github.com/podosoft-dev/podokit/commit/aa06b1dd5b6ecfde8371041c5253ff14328e211a)]:
  - @podosoft/podokit@0.17.0

## 0.2.0

### Minor Changes

- [#129](https://github.com/podosoft-dev/podokit/pull/129) [`7698c8a`](https://github.com/podosoft-dev/podokit/commit/7698c8a803908b9cf7efd093e0d8bf78e0d6db9a) Thanks [@korone00](https://github.com/korone00)! - Add guarded Kubernetes deployment profiles, deterministic Helm render and plan
  operations, exact-image migrations, confirmation-hash apply and rollback,
  deployment status and verification, plus read-only MCP inspection tools and a
  generated deployment skill.

  Add authenticated Redis connection settings, multi-replica Redis SSE delivery,
  extensible readiness checks, shared distributed rate limiting with a single
  managed application identity extension point, explicit adoption of existing
  Redis and rate-limit implementations, and production k3s ingress and readiness
  corrections. Development commands now activate Compose profiles required by the
  installed module graph.

### Patch Changes

- Updated dependencies [[`7698c8a`](https://github.com/podosoft-dev/podokit/commit/7698c8a803908b9cf7efd093e0d8bf78e0d6db9a), [`7698c8a`](https://github.com/podosoft-dev/podokit/commit/7698c8a803908b9cf7efd093e0d8bf78e0d6db9a)]:
  - @podosoft/podokit@0.16.0

## 0.1.9

### Patch Changes

- Updated dependencies [[`f174097`](https://github.com/podosoft-dev/podokit/commit/f1740974d833bdf00ef6e9dba37daf834c77fd8f)]:
  - @podosoft/podokit@0.15.0

## 0.1.8

### Patch Changes

- [#123](https://github.com/podosoft-dev/podokit/pull/123) [`4525328`](https://github.com/podosoft-dev/podokit/commit/4525328016cb3af38f5520ea41e170f6fe59cef6) Thanks [@korone00](https://github.com/korone00)! - Separate the generated admin-only console into the `(admin)` route group, keep `(app)` available for protected product pages, and migrate existing admin routes safely during `podo update`.

- Updated dependencies [[`820a4c5`](https://github.com/podosoft-dev/podokit/commit/820a4c5eb7c5553f749591e4e25dfc9318d77c3f), [`4525328`](https://github.com/podosoft-dev/podokit/commit/4525328016cb3af38f5520ea41e170f6fe59cef6), [`820a4c5`](https://github.com/podosoft-dev/podokit/commit/820a4c5eb7c5553f749591e4e25dfc9318d77c3f), [`cd7e13b`](https://github.com/podosoft-dev/podokit/commit/cd7e13b7a93b4fea7588ffed87c82ac5be8073ee)]:
  - @podosoft/podokit@0.14.0

## 0.1.7

### Patch Changes

- Updated dependencies [[`2940f05`](https://github.com/podosoft-dev/podokit/commit/2940f0590e6d64b16b2dcdd49413789f5acb2143), [`b05637f`](https://github.com/podosoft-dev/podokit/commit/b05637f68518080cf88bca87a79a8b9aae1aee25)]:
  - @podosoft/podokit@0.13.0

## 0.1.6

### Patch Changes

- Updated dependencies [[`b048480`](https://github.com/podosoft-dev/podokit/commit/b048480b8a35f1e26ad8c1c354822e1ea3477d22), [`b048480`](https://github.com/podosoft-dev/podokit/commit/b048480b8a35f1e26ad8c1c354822e1ea3477d22), [`b048480`](https://github.com/podosoft-dev/podokit/commit/b048480b8a35f1e26ad8c1c354822e1ea3477d22), [`b048480`](https://github.com/podosoft-dev/podokit/commit/b048480b8a35f1e26ad8c1c354822e1ea3477d22), [`b048480`](https://github.com/podosoft-dev/podokit/commit/b048480b8a35f1e26ad8c1c354822e1ea3477d22), [`b048480`](https://github.com/podosoft-dev/podokit/commit/b048480b8a35f1e26ad8c1c354822e1ea3477d22), [`b048480`](https://github.com/podosoft-dev/podokit/commit/b048480b8a35f1e26ad8c1c354822e1ea3477d22)]:
  - @podosoft/podokit@0.12.0

## 0.1.5

### Patch Changes

- Updated dependencies [[`b6267eb`](https://github.com/podosoft-dev/podokit/commit/b6267ebc568c01fdf35452c17a00a8d068cdcb36)]:
  - @podosoft/podokit@0.11.0

## 0.1.4

### Patch Changes

- Updated dependencies [[`c9d9bdf`](https://github.com/podosoft-dev/podokit/commit/c9d9bdf19c8b6ab77fcef8e619c0ccb79458ef8d), [`c9d9bdf`](https://github.com/podosoft-dev/podokit/commit/c9d9bdf19c8b6ab77fcef8e619c0ccb79458ef8d), [`c9d9bdf`](https://github.com/podosoft-dev/podokit/commit/c9d9bdf19c8b6ab77fcef8e619c0ccb79458ef8d), [`c9d9bdf`](https://github.com/podosoft-dev/podokit/commit/c9d9bdf19c8b6ab77fcef8e619c0ccb79458ef8d), [`c9d9bdf`](https://github.com/podosoft-dev/podokit/commit/c9d9bdf19c8b6ab77fcef8e619c0ccb79458ef8d), [`c9d9bdf`](https://github.com/podosoft-dev/podokit/commit/c9d9bdf19c8b6ab77fcef8e619c0ccb79458ef8d), [`c9d9bdf`](https://github.com/podosoft-dev/podokit/commit/c9d9bdf19c8b6ab77fcef8e619c0ccb79458ef8d), [`c9d9bdf`](https://github.com/podosoft-dev/podokit/commit/c9d9bdf19c8b6ab77fcef8e619c0ccb79458ef8d)]:
  - @podosoft/podokit@0.10.0
