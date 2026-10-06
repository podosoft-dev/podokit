---
"@podosoft/podokit": patch
---

Require configured S3 smoke tests to succeed and verify presigned downloads against the real storage service. Document complete data and IAM backups when upgrading existing MinIO installations to Silo.

Disable automatic dependency rollback when a Kubernetes-managed storage image changes, cannot be confirmed, or differs from Helm's recorded image, while preserving automatic application rollback. Require complete data and IAM recovery before restarting the previous storage image.

Pin development Silo and mc images by release and digest so local storage migration rehearsals use the same binaries.
