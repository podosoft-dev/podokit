---
"@podosoft/podokit": patch
---

Confirm the password when signing up.

Sign-up took the password once, while every form where an administrator sets someone
else's asks twice. It is the worst place for the omission: a mistyped sign-up costs
the account, because the address is not verified yet and the reset link that would
rescue it goes to an inbox the person cannot open.
