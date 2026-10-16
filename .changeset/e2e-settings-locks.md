---
"@podosoft/podokit": patch
---

The admin dashboard's Playwright specs that change a server-wide setting hold a lock shared by every worker on the machine, so a run with `--workers` above 1 no longer lets two specs flip the same setting at once: the `require2fa`, magic-link and OIDC provider flags, automatic logout, social sign-in providers, the General settings and the Appearance settings. A failing test releases its lock, and a lock left by a worker that exited is taken over at once.
