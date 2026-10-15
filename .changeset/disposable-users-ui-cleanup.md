---
"@podosoft/podokit": patch
---

The admin-dashboard `disposableUsers` Playwright fixture cleans up through its own request context in UI tests too, holding a copy of the browser's admin cookies. A UI test that signed its page in as another user used to turn cleanup into that user's requests, which failed with 403.
