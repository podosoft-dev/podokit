---
"@podosoft/podokit": patch
---

Load a page once more when another process's container start or stop fails it in a UI test. On Linux, Chromium cancels the requests still waiting for a connection whenever an interface address appears or disappears, which happens each time a container starts or stops on the host, so a `docker run` elsewhere on the machine failed module requests with `net::ERR_NETWORK_CHANGED`, the page did not hydrate, and the test failed with a static 500 page. The `admin-dashboard` hydration helpers `ready` and `hydrated` in `tests/helpers/hydration.ts` now open or reload such a page one more time when the failed load had a request dropped with `net::ERR_NETWORK_CHANGED`, add a `network-changed` annotation to the test, which the HTML report shows, and print the note with a `[network-changed]` prefix. Any other failure, and a second failure, fails the test as before.
