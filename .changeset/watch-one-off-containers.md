---
"@podosoft/podokit": patch
---

Stop `podo dev watch` from recreating a running service when `docker compose run` starts a one-off container of it, such as a second API for a test. Watch rebuilds a synced service whose new container came from an image older than the synced files, and it took the one-off container, which carries the service's label, for such a container, so the dev API answered 503 for about 8 seconds. One-off containers are now ignored.
