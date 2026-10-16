---
"@podosoft/podokit-module-blog": patch
---

Stop the blog migration from skipping the author foreign keys when Better Auth's `user` table does not exist yet, which happened when `migration:run` ran on a new database and left it migrated without them. The migration now stops with a message that names `bun run --cwd apps/api migrate:all`, and the install instructions use that command.
