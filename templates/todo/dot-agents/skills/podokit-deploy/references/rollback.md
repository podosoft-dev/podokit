# Application rollback

Preview the selected revision without `--confirm`, show the resulting plan hash, and obtain explicit approval before rerunning the command with that hash.

Rollback changes only the application Helm release. It does not reverse database migrations, change the dependency release, delete PersistentVolumeClaims, or delete Secrets. If the old application is incompatible with the current database schema, prepare a forward fix instead.
