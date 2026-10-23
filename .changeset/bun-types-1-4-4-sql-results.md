---
"@podosoft/podokit": patch
---

Keep the generated API type check passing with `@types/bun` 1.4.4. That release types a `Bun.SQL` query result as its rows plus `ResultMetadata` (`count`, `command`, and others), so the managed database pool and session expiry tests no longer type-checked when they compared a result with a plain array. They now compare the rows alone. A fresh install resolves `^1.4.0` to 1.4.4, so this failed for new projects even before the Bun pin moved.
