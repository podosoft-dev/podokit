---
"@podosoft/podokit": patch
---

Keep the outcome of a Kubernetes migration after its Job is gone. The migration Job is deleted with its logs an hour after it finishes, so deployment evidence collected later could not confirm that the release's migration ran. `podo deploy apply` now records each migration Job's release, job name, image digest, command, start and finish times, and result (`succeeded`, `failed` with the Job's reason, or `incomplete`) in the ConfigMap `<release>-migrations`, which keeps the latest 20 runs, before it continues or fails, and `podo deploy status` reports the newest one as `lastMigration`. A failed write of the record is a warning and does not stop the deployment.
