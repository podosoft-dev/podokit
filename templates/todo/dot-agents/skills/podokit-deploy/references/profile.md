# Deployment profile

The profile at `.podokit/deploy/<name>.json` is application-owned and contains no Secret values.

Initialize it with an explicit kubeconfig context:

```bash
npx @podosoft/podokit deploy init --profile production --context production --host app.example.com
```

Review the target, immutable API/web repositories, exposure, workloads, dependency modes, API/optional web Secret names and required keys, non-sensitive runtime configuration, and verification checks before planning.

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
