# Kubernetes deployment

PodoKit can plan and operate an application release on an existing Kubernetes-compatible cluster. The first tested driver is Helm on k3s. Cluster provisioning, DNS, TLS termination, registry accounts, Secret creation, and backups remain infrastructure responsibilities.

## Deployment boundary

PodoKit manages:

- API and web workloads, Services, disruption budgets, and web-only exposure
- optional in-cluster PostgreSQL, Redis, and S3-compatible object storage
- an exact-image migration Job before an application rollout
- deployment planning, status, public verification, and application rollback

PodoKit consumes:

- an explicit kubeconfig context and pre-existing namespace
- pre-built API and web images with one shared stable SemVer tag
- registry access through Docker Buildx so every tag can be resolved to a digest
- pre-existing API, optional web, dependency, and image-pull Secrets
- storage classes and public routing infrastructure

It never writes Secret values into a profile and does not create virtual machines, DNS records, registries, or backup repositories.

## Initialize a profile

Create a profile from the generated project:

```bash
podo deploy init \
  --profile production \
  --context production \
  --host app.example.com
```

PodoKit reads the selected context's server and public CA data to record a SHA-256 cluster fingerprint. It will refuse to apply a future plan if that fingerprint changes.

The application-owned profile is written to `.podokit/deploy/production.json`. Review it before use:

- target context, fingerprint, namespace, and Helm release
- API/web image repositories and the accepted stable tag pattern
- Ingress or NodePort exposure
- API/web replicas and CPU/memory resources, plus a BullMQ worker when installed
- PostgreSQL, Redis, and object storage modes and storage sizes
- names and required key names of existing workload Kubernetes Secrets
- an optional API migration command override
- non-sensitive runtime configuration
- public verification origin, exact statuses, and optional expected JSON fields

Initialization reads the installed PodoKit modules. Auth and API-key modules add their required API Secret key names, Redis-backed modules select persistent Redis, object storage selects MinIO, SSE selects Redis transport, and BullMQ adds a worker workload. Dependencies support `inCluster`, `external`, and `disabled`. External endpoints and credentials belong in the referenced API Secret, not in the profile. `runtimeConfig` rejects keys that look like passwords, tokens, private keys, or credentials, as well as URL values containing user information. The public verification origin must also be credential-free.

Profiles omit `migration` by default, which runs `npm run migrate:all` in the
exact API image. Applications with a different compiled migration entry point
can declare a command as an argument array:

```json
{
  "migration": {
    "command": ["node", "dist/migrate"]
  }
}
```

The `migration` object accepts only `command`. The command must be a non-empty
array of non-empty strings without newline or control characters. PodoKit emits
each argument as a safe YAML scalar rather than evaluating a shell command.

## Plan and apply

Run the read-only preflight:

```bash
podo deploy doctor --profile production
```

The doctor validates the exact cluster, namespace, Helm and Docker Buildx, IngressClass, TLS/image-pull Secret types, storage classes, and required Secret key names. It asks `kubectl` to output only key names and never prints or stores Secret values; the Kubernetes client still materializes each Secret while evaluating that output.

| Secret | Required keys |
| --- | --- |
| API | Profile-declared keys plus connection keys for enabled dependencies |
| web | Only profile-declared web keys; omitted by default |
| PostgreSQL dependency | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` |
| Redis dependency | `REDIS_PASSWORD` |
| object storage dependency | `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| image pull | Type `kubernetes.io/dockerconfigjson` |

Preview a release:

```bash
podo deploy plan --profile production --release v1.2.3 --json
```

The plan resolves application and managed dependency tags to immutable registry digests. It binds those digests, the profile, rendered manifests, application and dependency Helm revisions and statuses, and referenced workload, dependency, registry, and TLS Secret identities to one SHA-256 confirmation hash. Secret identities and runtime ConfigMap content also produce hashed Pod-template annotations, so a same-image apply rolls out workloads that otherwise would retain stale environment values. `latest`, branch tags, and empty tags are rejected. Planning uses a temporary render directory and does not change the project or cluster. Successful commands that return empty, malformed, or schema-invalid Helm or Kubernetes JSON fail closed.

After reviewing and explicitly approving that plan, apply the exact hash:

```bash
podo deploy apply \
  --profile production \
  --release v1.2.3 \
  --confirm <plan-hash>
```

Apply performs these steps:

1. Re-run the doctor.
2. Acquire a release-scoped Kubernetes Lease and recompute the plan while holding it.
3. Reconcile and wait for in-cluster dependencies.
4. Run the profile migration command with the exact API image. The default is
   `npm run migrate:all`.
5. Roll out API, web, and any configured worker with zero unavailable replicas.
6. Verify each configured public check's exact status and expected JSON fields, then release the Lease.

A second apply or rollback fails while the Lease is held, preventing concurrent migration Jobs. A process crash deliberately leaves a fail-closed Lease; inspect the interrupted deployment before deleting a confirmed stale Lease. A migration failure leaves the existing application workload unchanged. Helm 3 uses atomic upgrades; Helm 4 uses rollback-on-failure. A public verification failure leaves the migrated release deployed and reports the active revision, requiring an explicit compatible rollback or forward fix.

## Status and verification

```bash
podo deploy status --profile production --json
podo deploy verify --profile production --json
```

Status reports the application Helm revision, actual workload images, ready replicas, and restart totals. Verification checks the configured HTTPS origin without changing cluster state.

## Rollback

Preview a revision without a confirmation hash:

```bash
podo deploy rollback --profile production --revision 4
```

The rollback preview reads the selected Helm revision, reports its API/web image digests and manifest digest, and binds that exact target to the plan hash. Review the generated plan, then pass its exact hash:

```bash
podo deploy rollback \
  --profile production \
  --revision 4 \
  --confirm <rollback-plan-hash>
```

Rollback holds the same release Lease, then restarts the rolled-back workloads so they read the current Secret values before public verification. It does not reverse database migrations or dependency releases.

Rollback affects only the application Helm release. It does not reverse database migrations, change the dependency release, delete PersistentVolumeClaims, or delete Secrets. If an older image is incompatible with the current schema, use a forward fix.

## MCP and agent skill

The PodoKit MCP server exposes profile initialization plus read-only profile, doctor, plan, status, and verification tools. It intentionally does not expose cluster apply or rollback mutations.

Generated fullstack projects include the `podokit-deploy` skill for Codex and Claude. The skill requires the agent to show the target, images, migration warning, and exact plan hash before requesting approval for a CLI mutation.
