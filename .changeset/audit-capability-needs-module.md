---
"@podosoft/podokit": patch
---

Offer the admin audit page only when the audit-log module is installed. The container environment example no longer switches the audit log on for every app, and the audit capability now also requires the module, so an app without it no longer shows an audit page whose API does not exist (and an administrator switching the audit toggle on cannot bring that page back).
