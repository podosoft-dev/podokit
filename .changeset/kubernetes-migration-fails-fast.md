---
"@podosoft/podokit": patch
---

Stop a Kubernetes `podo deploy apply` within seconds when its migration fails. Apply waited with `kubectl wait --for=condition=complete --timeout=10m`, which returns only when the Job completes, so a migration that exited non-zero held apply for the full 10 minutes and then reported only that the wait timed out; the Job also retried the migration once after a back-off. Apply now stops as soon as the Job completes or fails, still within 10 minutes overall, and reports a failure with the last 20 log lines of the Job's pod, masking connection-URL passwords and values of keys such as `*_PASSWORD`, `*_SECRET`, and `*_TOKEN`. A Job still unfinished after 10 minutes is reported with what its pod is waiting for, such as `ImagePullBackOff`. The migration Job no longer retries (`backoffLimit: 0`).
