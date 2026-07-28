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
- pre-built API and web images sharing one stable SemVer tag
- registry access through Docker Buildx so every tag resolves to a digest
- pre-existing secrets — Kubernetes Secrets, or env files on the Docker host
- storage classes or Docker volumes, and public routing infrastructure

It never writes a secret value into a profile and does not create virtual machines,
DNS records, registries, TLS certificates, or backup repositories.

## Build and publish the images first

The deployment tooling consumes images; it does not build them. Build both with the
repository root as the context, tag them with the same stable SemVer tag, and push
them to a registry the target can pull from:

```bash
docker build -f apps/api/Dockerfile -t registry.example.com/example-app-api:v1.2.3 .
docker build -f apps/web/Dockerfile -t registry.example.com/example-app-web:v1.2.3 .
docker push registry.example.com/example-app-api:v1.2.3
docker push registry.example.com/example-app-web:v1.2.3
```

Build for the architecture the target runs. Building on an arm64 laptop and deploying
to an amd64 host produces `exec format error` at rollout — after the migration has
already run. Pass `--platform linux/amd64` (or use `docker buildx build --platform`)
when they differ.

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

Profiles omit `migration` by default, which runs `npm run migrate:all` in the exact
API image. Applications with a different compiled entry point declare one:

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
