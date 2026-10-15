---
"@podosoft/podokit": patch
---

Answer `503 DATABASE_UNAVAILABLE` from Better Auth endpoints while PostgreSQL is unreachable. `POST /api/auth/sign-in/email`, `GET /api/auth/get-session`, and session-protected routes answered `500`, because Better Auth reports a failed query as a bare `500` and its session lookup drops the cause. After a server error the auth module now checks its pool with `SELECT 1`, bounded by `READINESS_CHECK_TIMEOUT_MS`, and answers `503` only when that fails too; client errors and unrelated `500` errors are unchanged. Every `503` error envelope now carries `Retry-After: 1` unless the failing code set its own value.
