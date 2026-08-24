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

- API and web workloads, their service wiring, and web-only public exposure
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

The generated Node and Bun production Dockerfiles both install only the target
application workspace. The Bun 1.4.0 profile uses its pinned Alpine image and
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

Initialization reads the installed modules. Auth and API-key modules add their
required secret key names, Redis-backed modules select Redis, object storage selects
MinIO, SSE selects the Redis transport, and BullMQ adds a worker. Dependencies support
`external` and `disabled` as well as PodoKit-managed. External endpoints and
credentials belong in the referenced secret, not in the profile. `runtimeConfig`
rejects keys that look like passwords, tokens, private keys, or credentials, and
values containing URL user information.

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
5. Roll out API, web, and any worker, and wait for them to become healthy.
6. Verify each configured public check, then release the lock.

A second apply or rollback fails while the lock is held, which is what prevents
concurrent migrations. A crash deliberately leaves the lock behind; inspect the
interrupted deployment before removing it.

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

Public traffic enters through the web app, and a SvelteKit route cannot answer an
upgrade — `+server.ts` handlers never see one, and the `/api/*` proxy is `fetch`-based,
which cannot carry a 101. An API WebSocket gateway is therefore unreachable in a
deployment unless the web server relays it.

Generated projects ship `apps/web/server.js`, which is the image's entry point. It
keeps adapter-node in charge of listening and graceful shutdown and adds an upgrade
proxy for the paths named in `WS_PROXY_PATHS`:

```json
{ "runtimeConfig": { "WS_PROXY_PATHS": "/events/ws" } }
```

Empty by default, so a deployment with no WebSocket behaves exactly as before. Each
entry is matched **whole** — not as a prefix or a pattern — and anything else asking
to upgrade is destroyed rather than proxied. Adding a path is a security decision: the
API must authorise that socket at handshake time, because the relay forwards whatever
the caller sent.

Set the same value in the shell that runs `vite dev`, or the feature works in
development and fails only once deployed.

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

What it copies is exactly what the images copy in beside their dependency tree: each
`packages/*/dist`, `apps/api/dist` and `apps/api/scripts`, `apps/web/build`, and the
two things the web image ships as source rather than bundle — `apps/web/server.js`
and `apps/web/src/lib/server`. The API payload goes to the worker container too: it
runs the same image but is a different container, and writable layers are per
container. `node_modules` is never copied.

**It refuses rather than warns** when the result could not be trusted:

| Refusal | Why |
| --- | --- |
| runtime dependencies differ from the container's manifests | the image installed `--omit=dev` from the old manifest, so the new code would import a package that is not there — a crash loop after the restart, not a copy error |
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
