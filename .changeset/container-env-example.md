---
"@podosoft/podokit": minor
---

Give fresh clones a container environment without committing secrets. Generated apps ship a committed `.env.docker.example` (with an empty `BETTER_AUTH_SECRET`) and a `.gitignore` exception for it instead of an ignored `.env.docker`, so a clone used to fail with "env file .env.docker not found". Every `podo dev` command except `url` creates the untracked `.env.docker` from the example when it is missing and fills each empty `*_SECRET` value with a random one; an existing `.env.docker` is never changed. `podo dev env` does only that step, and the devcontainer runs it as its `initializeCommand`. `podo update --apply` adds the example and the `.gitignore` exception to existing apps and keeps their `.env.docker`.
