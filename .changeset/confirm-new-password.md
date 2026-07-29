---
"@podosoft/podokit": patch
---

Confirm a new password when resetting it or changing it from the account page.

Both forms took the new password once. A reset spends a single-use token, so a typo
costs another trip through the mailbox; a change from the account page simply
succeeds, and the mistake surfaces at the next sign-in with a password the person
cannot reproduce.
