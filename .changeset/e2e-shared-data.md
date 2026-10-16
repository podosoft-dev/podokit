---
"@podosoft/podokit": patch
"@podosoft/podokit-module-blog": patch
---

Keep the generated e2e specs from depending on data other tests change at the same time. `clearMailpit()` and `clearSms()` are removed, because emptying the shared Mailpit inbox or SMS sink lost the messages other tests were waiting for; every spec already mails and texts recipients of its own. The organization spec picks the seeded user as a manager instead of the first user listed, and the blog comment validation spec posts to a post of its own.
