---
"@podosoft/podokit": patch
---

Make `podo deploy status` on Kubernetes count only the restarts of the running pods of each Deployment's current revision, matched through the ReplicaSet that carries its `deployment.kubernetes.io/revision` annotation, instead of every pod with the workload label. Pods of an earlier revision or still terminating, which remain for their grace period after `podo deploy apply` and `rollback`, are reported separately as `previousPods` with their count and restarts, so a fresh release no longer shows the replaced pods' restarts. Pods and ReplicaSets are read as JSON and an unexpected shape fails the command.
