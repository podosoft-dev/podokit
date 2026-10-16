---
"@podosoft/podokit": patch
---

Count signed-in callers per user in the rate-limit module. Each API process learns the user of every session that authentication resolves for a request, through a new `RESOLVED_SESSIONS` registry in the generated API core that the auth module reports to, and keys that caller's counter by user until the session expires, so one user's sessions on several devices, addresses, or replicas share one budget. The limiter still reads no session from the database and makes no extra Redis call; a session the process has not resolved yet keeps its own counter, API keys still come first, and forged sessions still count by client address.
