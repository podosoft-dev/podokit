# Deployment profile

The profile at `.podokit/deploy/<name>.json` is application-owned and contains no Secret values.

Initialize it with an explicit kubeconfig context:

```bash
npx @podosoft/podokit deploy init --profile production --context production --host app.example.com
```

Review these fields before planning:

- `target`: context, cluster fingerprint, namespace, release
- `release`: API/web repositories and stable SemVer tag pattern
- `exposure`: Ingress or NodePort; Ingress routes every public path to web
- `workloads`: API/web replicas and resources plus an optional worker
- `dependencies`: PostgreSQL, Redis, and object storage mode, image, Secret name, and storage
- `secrets`: API/optional web Secret names and required key names, plus image-pull Secret
- `runtimeConfig`: non-sensitive environment values only
- `verification`: HTTPS origin and checks with exact statuses and optional JSON fields

The cluster namespace and referenced Secrets must already exist. PodoKit asks `kubectl` to output only Secret key names and never prints or stores their values; the Kubernetes client still materializes the Secret while evaluating that output.

Required keys:

| Secret | Required keys |
| --- | --- |
| API | Profile-declared keys plus enabled dependency connection keys: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `REDIS_PASSWORD`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| web | Only explicitly declared web keys; omitted by default |
| PostgreSQL dependency | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` |
| Redis dependency | `REDIS_PASSWORD` |
| Object storage dependency | `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| image pull | A `kubernetes.io/dockerconfigjson` Secret |

Use `inCluster` when the generated Helm release should manage a dependency, `external` when application configuration points to an existing service, and `disabled` only when the application does not require it.

Use the same stable SemVer tag for API and web. `latest`, branch tags, and empty tags are rejected. Planning resolves every deployed tag to an immutable registry digest through Docker Buildx.
