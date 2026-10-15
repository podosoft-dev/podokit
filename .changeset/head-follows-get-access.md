---
"@podosoft/podokit": patch
---

Answer `HEAD` requests to routes that are public for `GET`. The API's `AccessPolicy` matched rules by exact method, so `HEAD /profile-images/:fileName` and `HEAD /site/favicon` answered `401` although their `GET` is public. A `HEAD` request now also matches `GET` rules, unless a later `HEAD` rule overrides them; Elysia answers it with the GET handler, so it carries the GET response's headers without the body.
