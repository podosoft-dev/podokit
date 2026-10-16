---
"@podosoft/podokit-module-analytics": patch
---

Use `bun run --cwd apps/api migrate:all` in the install instructions, so a new database gets the Better Auth tables that the required admin dashboard needs.
