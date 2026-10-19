---
"@podosoft/podokit": patch
---

Name each service's containers in a Docker Compose `podo deploy status`. Since side-by-side rollouts, a release starts new containers beside the old ones and removes the old, so Compose numbers them after the highest one in use and `<project>-<project>-api-1` becomes `-2`, `-3`, and so on with every release. Tooling that used a fixed container name, such as a backup that ran `docker exec` on the API container, stopped finding it. Status now lists the current names under each service's `containers`, and `docs/deployment.md` explains the renumbering and how to select a service's containers by their `com.docker.compose.project` and `com.docker.compose.service` labels instead.
