---
"@podosoft/podokit": minor
"@podosoft/podokit-contracts": minor
---

Cut the fixed cost of every request in generated apps. Session reads no longer sign an unused JWT header, unsigned bearer values are rejected without a session lookup, and rate limiting keys signed sessions by a verified cookie hash instead of a database lookup. Server rendering loads site settings and the session together, memoizes capabilities per request, and stops resending the message catalog on client navigation. `Capabilities` gains `require2fa`. Site settings come from one cached query, the merged OpenAPI document is reused, the rate-limit script runs by SHA, and OAuth consent sends the signed authorization query.
