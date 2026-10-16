# Deployment

PodoKit can plan and operate an application release on a target you already run. Two
drivers are supported, and a deployment profile declares which one it uses:

| Driver | Target | Reach for it when |
| --- | --- | --- |
| `kubernetes-helm` | a kubeconfig context and namespace | you already operate a cluster, or you need more than one node, cluster-managed rollouts, or independent scaling per workload |
| `docker-compose` | a Docker context, local or `ssh://` | one machine is the whole deployment, and a reverse proxy in front of it terminates TLS |

Neither driver provisions the target. Host or cluster provisioning, DNS, TLS
termination, registry accounts, secret creation, and backups remain infrastructure
responsibilities.

## Deployment boundary

PodoKit manages:

- API and web workloads, their service wiring, and exact WebSocket and direct API
  routing when configured
- optional PodoKit-run PostgreSQL, Redis, and S3-compatible object storage
- an exact-image migration step before an application rollout
- deployment planning, status, public verification, and application rollback

PodoKit consumes:

- an explicit target context and a fingerprint of it recorded in the profile
- pre-built API and web images sharing one stable SemVer tag — generated projects get
  a workflow that builds them, but CI runs it, not the deployment tooling
- registry access through Docker Buildx so every tag resolves to a digest
- pre-existing secrets — Kubernetes Secrets, or env files on the Docker host
- storage classes or Docker volumes, and public routing infrastructure

It never writes a secret value into a profile and does not create virtual machines,
DNS records, registries, TLS certificates, or backup repositories.

New deployment profiles default to pinned [Silo](https://github.com/pgsty/silo)
server and client images for managed S3-compatible storage. The existing
`MINIO_*` secret keys and service names remain compatible. Profiles already
written to disk keep their recorded image references; update those references
to `pgsty/silo:RELEASE.2026-09-16T00-00-00Z` and
`pgsty/mc:RELEASE.2026-09-16T00-00-00Z` before applying a new plan.

### Upgrading an existing MinIO installation

Keep the existing service, bucket, volume/PVC, endpoint, and secret references.
Before upgrading, pause application writes and IAM administration, stop the
storage processes, and back up the complete data volume, including `.minio.sys`,
file permissions, deployment configuration, and required encryption material.
Preserve the previous image from the local cache when its registry is unavailable.

Rehearse the upgrade and recovery on an isolated copy before applying the
confirmed deployment plan. An object-only backup or live IAM export does not
preserve the complete IAM history. Recovery requires the full compatible backup
and previous image; starting the old image against an upgraded volume is unsafe.
See the [Silo IAM upgrade and recovery guide](https://silo.pgsty.com/operations/replication/iam-upgrade/).

## Build and publish the images first

The deployment tooling consumes images; it does not build them. Generated projects
ship `.github/workflows/release.yml`, which does: pushing a `v*.*.*` tag verifies the
commit, builds both images with the repository root as the context, and pushes them
under that one tag. It stops there. Rolling out requires confirming a plan hash, and
that approval belongs to a person.

Read that file before the first tag — it documents the three variables and two
secrets it reads, and the runner choice below is the one that costs money if it is
left at its default in a private repository.

### Choosing the runner, and what it costs

**GitHub-hosted runners are free for public repositories only.** In a private
repository every minute is metered against the account's included Actions minutes and
billed beyond them, and image builds are usually the most expensive job a project
runs. A self-hosted runner consumes no Actions minutes at all, whatever the
repository's visibility.

| | GitHub-hosted (`ubuntu-latest`) | Self-hosted |
| --- | --- | --- |
| Public repository | free | free |
| Private repository | **metered, then billed** | free |
| Architecture | whatever the label provides | the machine's own |
| Setup | none | register a runner, label it |

The workflow reads the choice from a repository or organization variable, so it is
one setting rather than an edit:

```
PODOKIT_RUNNER   JSON array of labels. Unset -> ["ubuntu-latest"].
                 Self-hosted example: ["self-hosted","Linux","X64"]
```

Nothing warns you when a private repository is still on the default: the workflow
succeeds either way and the difference appears on a bill. Set it before the first tag.

### Building by hand

The equivalent, when a tag is not the trigger you want:

```bash
docker build -f apps/api/Dockerfile -t registry.example.com/example-app-api:v1.2.3 .
docker build -f apps/web/Dockerfile -t registry.example.com/example-app-web:v1.2.3 .
docker push registry.example.com/example-app-api:v1.2.3
docker push registry.example.com/example-app-web:v1.2.3
```

The generated Bun production Dockerfiles install only the target application
workspace. The Bun 1.4.0 profile uses its pinned Alpine image and
`bun install --production --frozen-lockfile --filter './apps/api'` (or
`./apps/web`) so one image does not carry the other application's runtime
dependencies.

**Build for the architecture the target runs.** Building on an arm64 laptop and
deploying to an amd64 host produces `exec format error` at rollout — after the
migration has already run. Pass `--platform linux/amd64` (or use
`docker buildx build --platform`) when they differ, and expect it to be slow: the
build then runs under emulation, which is the usual reason a "Docker is too slow to
iterate on" complaint turns out not to be about Docker. A native runner of the
target's architecture removes that cost entirely, which is the other reason to set
`PODOKIT_RUNNER`.

A bare local tag cannot be deployed: it does not match the stable SemVer pattern and
cannot be resolved to a digest.

## Initialize a profile

Kubernetes:

```bash
podo deploy init \
  --profile production \
  --context production \
  --host app.example.com
```

Docker Compose:

```bash
podo deploy init \
  --profile production \
  --driver docker-compose \
  --context production \
  --host app.example.com \
  --secrets-dir /etc/podokit/example-app
```

PodoKit records a fingerprint of the target — the cluster's server and CA data, or the
Docker endpoint and daemon ID — and refuses to apply a future plan if it changes.

The application-owned profile is written to `.podokit/deploy/production.json`. Review
it before use: the target, the image repositories and accepted tag pattern, exposure,
replicas and resources, dependency modes, the names (never the values) of the secrets
it reads, an optional migration command, non-sensitive runtime configuration, and the
public verification checks.

Initialization reads the manifest's active providers and installed modules. Auth
and API-key modules add their required secret key names, distributed providers
select PostgreSQL, Redis, or Silo, BullMQ adds a worker, and the
[direct API paths](#direct-api-paths) that installed modules contributed, such as
`file-upload`'s `/api/files/uploads/`, go into `exposure.apiPaths`. Local providers
disable their managed external dependency, omit the separate worker, and constrain
the API to one replica. Dependencies support
`external` and `disabled` as well as PodoKit-managed. External endpoints and
credentials belong in the referenced secret, not in the profile. `runtimeConfig`
rejects keys that look like passwords, tokens, private keys, or credentials, and
values containing URL user information.

Provider selection is configuration, not data migration. A deployment plan does
not copy or delete database rows, Redis state, queued jobs, or stored objects.
See [Runtime providers](providers.md) before changing a deployed project.

Profiles omit `migration` by default, which runs the selected project's package
manager (`bun run migrate:all`) in the exact API image.
Applications with a different compiled entry point declare one:

```json
{ "migration": { "command": ["node", "dist/migrate"] } }
```

### Where secrets live

The two drivers differ only in the mechanism.

| | `kubernetes-helm` | `docker-compose` |
| --- | --- | --- |
| Application | pre-existing Kubernetes Secrets, referenced by name | env files on the target host, referenced by absolute path |
| Registry | an image-pull Secret of type `kubernetes.io/dockerconfigjson` | `docker login` on the target host |
| Inspection | `kubectl` is asked for key names only | a throwaway container prints key names from a read-only mount |

Required keys are the same on both:

| Secret | Required keys |
| --- | --- |
| API | Profile-declared keys plus connection keys for enabled dependencies |
| web | Only profile-declared web keys; omitted by default |
| PostgreSQL | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` |
| Redis | `REDIS_PASSWORD` |
| Object storage | `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |

⚠ The API secret must carry the dependency connection values **as well as** each
dependency's own secret. There is no tooling that keeps the two in sync, and a
mismatch means the application authenticates against a database it just provisioned
with a different password. The doctor reports the missing keys by name.

## Plan and apply

```bash
podo deploy doctor --profile production
podo deploy plan --profile production --release v1.2.3 --json
```

The doctor is read-only. It validates the exact target, the tooling, the fingerprint,
and the required secret key names without printing a value.

The plan resolves every image tag to an immutable registry digest and binds those
digests, the profile, the rendered output, the current revision, and the identity of
every referenced secret into one SHA-256 confirmation hash. `latest`, branch tags, and
empty tags are rejected. Planning does not change the project or the target.

After reviewing that plan, apply the exact hash:

```bash
podo deploy apply --profile production --release v1.2.3 --confirm <plan-hash>
```

Apply performs the same steps on both drivers:

1. Re-run the doctor.
2. Take a release-scoped lock and recompute the plan while holding it — a Kubernetes
   Lease, or a `set -C` lock file in a state volume.
3. Reconcile and wait for PodoKit-run dependencies.
4. Run the migration with the exact API image digest.
5. Roll out API, web, any worker, and the optional Compose gateway, then wait for health.
6. Verify each configured public check, then release the lock.

A second apply or rollback fails while the lock is held, which is what prevents
concurrent migrations. A crash deliberately leaves the lock behind; inspect the
interrupted deployment before removing it.

For Kubernetes-managed object storage, apply reads the current storage StatefulSet
while holding the Lease and compares its server image with the approved image and
the image recorded in Helm's dependency manifest. Helm's YAML is parsed with a
client dry-run without creating resources. If any image changes, cannot be
confirmed, differs between the live resource and Helm's manifest, or belongs to a
dependency release that is not deployed, PodoKit warns and disables automatic
Helm rollback for the dependency chart. It still waits for dependencies and stops before migrations or
application rollout if the dependency upgrade fails. A failed storage upgrade
requires deliberate recovery: stop storage and restore the complete compatible
data and IAM backup before starting the previous image.

Application upgrades retain automatic rollback through Helm 3's
[`--atomic`](https://helm.sh/docs/v3/helm/helm_upgrade/) or Helm 4's
[`--rollback-on-failure`](https://docs.helm.sh/docs/helm/helm_upgrade/).
External object storage, unchanged live and recorded managed server images in a
deployed release, and new installations keep the existing Helm behavior. This execution safeguard
does not change the rendered manifests or the plan confirmation hash.

### ⚠ The migration runs against the release that is still serving

Step 4 happens before step 5, and step 5 keeps the previous release serving until the
last container is replaced. **A migration must therefore be compatible with the code
already running.**

- Additive changes are safe: new tables, new nullable columns, new indexes.
- Dropping or renaming a column, or tightening a constraint, breaks the running
  release the moment the migration commits — before any new code is live.
- Destructive changes belong in a second release, after the code that stopped using
  the column has fully rolled out.

Rollback does not reverse migrations. If an older image cannot read the current
schema, roll forward instead.

## WebSocket endpoints

Public WebSocket upgrades bypass the web service and go directly to the API service.
List every permitted endpoint under `exposure.webSocketPaths` in the deployment
profile. For Kubernetes Ingress:

```json
{
  "exposure": {
    "mode": "ingress",
    "webSocketPaths": ["/events/ws"]
  }
}
```

For Docker Compose:

```json
{
  "exposure": {
    "mode": "publishedPort",
    "webSocketPaths": ["/events/ws"],
    "trustedProxyCidrs": [],
    "gatewayImage": "caddy:2.10-alpine"
  }
}
```

The list is empty by default. Kubernetes renders `pathType: Exact` routes. Compose
inserts a small internal gateway on the one published port: exact listed paths go to
API and every other request goes to web. The external TLS reverse proxy therefore
keeps one upstream and does not need to duplicate the path split. Planning resolves
the gateway image to an immutable digest like every other image. With an empty list,
Compose keeps the previous layout and publishes web directly without a gateway.

Root, wildcard, query, fragment, encoded-separator, and traversal values are rejected
while the profile is loaded, so a sibling path cannot reach API accidentally. On
Kubernetes this option requires `exposure.mode: "ingress"`; a NodePort cannot split
traffic between two services.

Both routers preserve the request cookie during the upgrade. The API must still
authenticate and authorize the handshake. The Compose gateway trusts forwarded
headers only from the IP networks listed in `trustedProxyCidrs`; keep the list empty
when there is no external proxy. Configure the direct upstream proxy CIDRs, not
arbitrary client networks, and keep the published address reachable only by those
proxies. Caddy strict proxy parsing then derives the client address from the first
untrusted hop and safely replaces spoofed forwarding headers from other peers.

Kubernetes deployments configure the web server to trust the ingress-provided
`x-forwarded-proto` and `x-forwarded-host` headers. This keeps SvelteKit's
same-origin form protection correct for multipart uploads and other form content.
For a Docker Compose deployment behind a trusted reverse proxy, first list that
proxy's direct CIDR blocks in `trustedProxyCidrs`, then add matching
`PROTOCOL_HEADER` and `HOST_HEADER` values to `runtimeConfig`. Do not enable those
settings when untrusted clients can reach the container directly. A directly served
plain-HTTP image can instead set its origin while building:

```bash
docker build --build-arg PODOKIT_BUILD_ORIGIN=https://example.com -f apps/web/Dockerfile -t example-web .
```

## Direct API paths

By default every `/api/*` request goes through the web server, which proxies it
to the API. The web server holds the whole body in memory, and adapter-bun rejects any
body larger than `BODY_SIZE_LIMIT` (3 MiB in the generated configuration) on every
web route; per-route `APP_BODY_LIMITS` can only lower that ceiling (see
[request body limits](templates.md#request-body-limits)). To accept larger uploads, list the API routes that receive them under
`exposure.apiPaths`. The gateway then sends those requests straight to the API, so
their bodies never pass through the web process:

```json
{
  "exposure": {
    "mode": "ingress",
    "apiPaths": ["/api/files/uploads/"]
  }
}
```

Each entry is a static prefix under `/api/`. It covers its own path and every path
below it, so `/api/files/uploads/` covers `/api/files/uploads` and
`/api/files/uploads/u1/parts/2`; the trailing slash is optional. The gateway
removes `/api`, so `/api/files/uploads/u1/parts/2` reaches the API as
`/files/uploads/u1/parts/2`, the same path the web proxy forwards. The list is
empty by default. Modules whose routes need a direct path declare it, and
`podo add` lists it in every existing profile while `podo deploy init` copies it
into new ones: the `file-upload` module adds exactly this entry for its
[resumable uploads](modules.md#resumable-uploads), whose parts exceed
`BODY_SIZE_LIMIT`. See [module direct API paths](modules.md#module-direct-api-paths)
for how `podo add`, `remove`, and `update` edit the list.

The profile is rejected if an entry is `/api/` itself, contains a wildcard, query,
fragment, percent-encoded character, empty segment, or traversal segment, overlaps
another entry, or covers a `webSocketPaths` entry. `/api/auth` and the paths below
it are rejected as well: the API serves Better Auth with the `/api/auth` prefix
still in place, so authentication requests always go through the web proxy.

| Driver | Routing |
| --- | --- |
| `kubernetes-helm` | Requires `exposure.mode: "ingress"` and an IngressClass served by Traefik. The application chart adds a second Ingress, `<release>-api-paths`, with an `Exact` rule for each path and an `ImplementationSpecific` rule for the path with a trailing slash, plus a Traefik `Middleware`, `<release>-strip-api-prefix`, that removes `/api`. `podo deploy doctor` checks that the `middlewares.traefik.io` CRD exists. |
| `docker-compose` | Listed paths start the same internal Caddy gateway as WebSocket paths. It removes `/api` with `uri strip_prefix` before proxying to the API, and `trustedProxyCidrs` applies to these requests too. |

The plan's rollout step names the direct paths, and the confirmation hash covers
them through the profile digest and the rendered Ingress or Caddy configuration.
For local development, the same paths belong in `.podokit/dev.json`, where
`podo add` puts module paths too; see the
[development guide](development.md#containerized-development).

What changes for requests on these paths:

- They stay on the public origin, so the browser sends the session cookie and
  applies same-origin rules exactly as it does for the rest of `/api`. The API
  authenticates them itself, as it already does for proxied requests.
- They skip everything the web server does for `/api`: the forwarded header
  allowlist (the API receives every request header), `APP_BODY_LIMITS`,
  SvelteKit's cross-site form check, and any `+server.ts` routes the app added
  under the prefix. For cookie-authenticated writes, have the API compare the
  `Origin` header with the public origin; the session cookie's `SameSite=Lax`
  already keeps it off most cross-site POSTs.
- The API's CORS headers reach the browser. Keep `CORS_ORIGIN` set to the public
  origin, as generated profiles do; without it the API reflects any origin and
  allows credentials.
- The API server's own body limit applies instead of `BODY_SIZE_LIMIT`: Bun's
  `maxRequestBodySize`, 128 MiB unless the API sets another value. Enforce each
  route's size limit in its API handler.
- The API reads the client address from the gateway's `X-Forwarded-For` header
  instead of from the web server. Behind an external reverse proxy, check that
  `RATE_LIMIT_TRUSTED_PROXY_HOPS` picks the client on these paths.
- Gateway timeouts still apply. Traefik v3 entry points close a request whose body
  takes longer than `respondingTimeouts.readTimeout`, 60 seconds by default; raise
  it on the ingress controller for slow uploads.

## Fast development sync (`docker-compose` only)

Developing *against* a deployment through full releases is slow for a reason that has
nothing to do with the change: a release rebuilds dependencies that did not move,
pushes them, and recreates containers. When the only thing that changed is compiled
output, `podo deploy sync` copies that output into the containers that are already
running and restarts them.

```bash
podo deploy sync --profile production --build
podo deploy sync --profile production --revert
```

`--build` compiles first, in the order the images do it — every `packages/*` before
the apps, because a root `build` script runs workspaces in manifest order and an app
listed first compiles against a workspace package's previous output.

**It is not a release, and the difference is the point:**

- The image tag does not change, so the deployment runs code its tag does not
  describe. A marker file records that, and `podo deploy status` reports it under
  `syncDrift`.
- Nothing is pushed anywhere, so nothing is reproducible from it.
- The next `apply` — or any container recreate — discards it, because a container's
  writable layer does not survive recreation. The drift heals itself, which is what
  keeps this from becoming a second deployment path.

What it copies is exactly what the images run: `packages/*/dist`, `apps/api/dist`,
and `apps/api/scripts` for API/worker containers, plus `apps/web/build` for the web
container. The official Bun adapter bundles the web application and its dependencies,
so the web build is self-contained and has no runtime `node_modules` or package
manifest to compare. The API payload goes to the worker container too: it runs the
same image but is a different container, and writable layers are per container.
`node_modules` is never copied.

**It refuses rather than warns** when the result could not be trusted:

| Refusal | Why |
| --- | --- |
| API/worker runtime dependencies differ from the container's manifests | those images installed the old dependency graph, so the new code could import a package that is not there — a crash loop after the restart, not a copy error; the bundled web build is exempt |
| a release holds the deployment lock | an apply is in progress |
| no running container for the project | there is nothing to sync into; deploy a release first |
| `--clean` with an exclude beneath a synced path | emptying that destination would delete artifacts this machine cannot rebuild |
| a restarted container does not become healthy | the copy already happened, so this has to be said rather than swallowed |

It never runs migrations. A change that needs one belongs in a release: the migration
would otherwise commit against containers that are about to be replaced by hand.

### Excluding part of a build output

Some of a build output can come from a toolchain the developer's machine does not
have. Overwriting that part with a local build replaces real artifacts with an index
of artifacts that are no longer there — and the application keeps serving pages while
the missing files 404, so nothing looks broken. Name those paths in the profile:

```json
{ "sync": { "exclude": ["apps/web/build/static-assets/generated"] } }
```

The key is read only by `sync`. It is never rendered into the Compose project, so
adding it changes what that one command copies and nothing about what is deployed.

## Request body limit

The API refuses request bodies larger than `API_MAX_REQUEST_BODY_SIZE` bytes
with `413`. It defaults to Bun's 128 MiB. Set it in the profile's
`runtimeConfig`, or set `maxRequestBodySize` in the application's
`apiServerOptions` (see [API server options](templates.md#api-server-options)),
which wins over the environment. Proxies in front of the API, including the web
app's `BODY_SIZE_LIMIT` and any ingress, apply their own limits.

## Health probes

The API serves two health endpoints. `GET /health` reports that the process is
running. `GET /health/ready` runs `SELECT 1` against the database and every
readiness check that installed modules register, such as Redis, the event bus,
the BullMQ producer, and the object storage bucket. It answers `503` with the `READINESS_FAILED` error code
when any of them is down, and its message names them, for example
`One or more dependencies are unavailable: redis, events`.

The API starts and listens even when PostgreSQL or Redis is unreachable. Before
listening it makes one connection attempt to each. When a server does not answer
at all, startup waits up to the connection timeout for that attempt
(`DB_CONNECT_TIMEOUT_MS` for PostgreSQL, 5 seconds for Redis), and once more for
each start hook that reads the database, such as the auth module's
configuration preload. After that the API keeps reconnecting in the background,
starting after 250 ms and doubling the wait up to 5 seconds. A Redis connection
that drops later is reopened the same way, while the PostgreSQL pool opens
connections as queries need them. A Redis server that keeps the connection open
but stops answering, such as a paused container, fails each command after
`REDIS_COMMAND_TIMEOUT_MS`, and that connection is closed and reopened the same
way. A PostgreSQL server that does the same fails the waiting queries after
`DB_QUERY_TIMEOUT_MS`, and the API reopens its pool (see
[PostgreSQL connection pools](providers.md#postgresql-connection-pools)).
Until a dependency is back, `GET /health` answers `200`, `GET /health/ready`
answers `503`, and requests that need it fail with their usual errors, such as
`DATABASE_UNAVAILABLE`, `JOBS_UNAVAILABLE`, or `RATE_LIMIT_UNAVAILABLE`, instead
of waiting for it. These `503` responses
carry `Retry-After`, `1` second unless the code that failed set its own. The API logs
`Dependency connection failed; retrying in the background` when a dependency
becomes unavailable and `Dependency connection restored` with `downtimeMs` when
it returns, not on every attempt. A pod therefore stays running while a
dependency is down and becomes ready again without a restart.

| Setting | Default | Effect |
| --- | --- | --- |
| `READINESS_CHECK_TIMEOUT_MS` | `800` | The longest one check may run. A slower check is reported down, and the API logs `Readiness check failed` with the check name and the reason. |
| `READINESS_CACHE_MS` | `2000` | How long a finished result is reused. Concurrent requests always share one evaluation. `0` checks on every request. |
| `REDIS_COMMAND_TIMEOUT_MS` | `1000` | How long the API waits for Redis to answer one command before the command fails and its connection is reopened. |

Set them in the profile's `runtimeConfig`. Keep the check timeout below the probe
timeout, so a slow dependency is reported as down instead of making the probe
itself time out. The rendered Kubernetes readiness, liveness, and startup probes
give the API `timeoutSeconds: 2` instead of the Kubernetes default of one second.
The Compose healthcheck allows `5s`, because it starts a Node process for every
check.

The web workload's probes request `/`, which renders without the API, so an
API outage does not take the web pods out of service. The web server gives up
on each server-side API call after `BACKEND_TIMEOUT_MS`, waits for the `/api`
proxy's response headers up to `BACKEND_PROXY_TIMEOUT_MS`, and, once the API's
`GET /health` does not answer either, fails API calls at once until it does;
see [API timeouts and outages](templates.md#api-timeouts-and-outages).

| Web setting | Default | Effect |
| --- | --- | --- |
| `BACKEND_TIMEOUT_MS` | `2000` | The longest one server-side API call may take, and the proxy's wait for response headers before it checks whether the API answers at all. Detecting an outage takes up to twice this long, and pages rendered meanwhile wait for it, so a large value can fail the web probes. |
| `BACKEND_PROXY_TIMEOUT_MS` | `30000` | How long the `/api` proxy waits for response headers before it answers `504` `BACKEND_TIMEOUT`. Raise it with the API's `idleTimeout` and the web server's `CONNECTION_IDLE_TIMEOUT`. |

Set them in the profile's `runtimeConfig`.

## Status and verification

```bash
podo deploy status --profile production --json
podo deploy verify --profile production --json
```

Status reports the deployed revision, the actual images, ready or running replicas,
and restart totals. Verification checks the configured HTTPS origin without changing
the target.

## Rollback

Preview a revision without a confirmation hash, then pass the hash it prints:

```bash
podo deploy rollback --profile production --revision 4
podo deploy rollback --profile production --revision 4 --confirm <rollback-plan-hash>
```

The Kubernetes driver selects a Helm revision. The Compose driver selects an entry
from a release ledger kept in its state volume, and refuses if the profile has changed
so much that the revision can no longer be reproduced byte for byte — roll forward
instead.

Rollback affects only the application. It does not reverse database migrations, change
the dependency release, delete volumes or PersistentVolumeClaims, or delete secrets.

## MCP and agent skill

The PodoKit MCP server exposes profile initialization plus read-only profile, doctor,
plan, status, and verification tools. Each one follows whichever driver the named
profile declares. It intentionally exposes no apply or rollback mutation.

Generated projects include the `podokit-deploy` skill for Codex and Claude. The skill
requires the agent to show the driver, the target, the images, the migration warning,
and the exact plan hash before requesting approval for a CLI mutation.
