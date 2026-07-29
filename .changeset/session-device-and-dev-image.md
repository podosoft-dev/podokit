---
"@podosoft/podokit": patch
---

Show the real device on a session, and build the dev image for a project with
shared packages.

The server proxy did not forward `user-agent`, and fetch supplies its own default
when the header is absent — so every session recorded "node" and the account page
showed that as the device for all of them. The proxy now forwards it, and the
sessions tables render a readable name ("Chrome · macOS") with the exact string on
hover, falling back to the raw value for anything that is not a browser.

`Dockerfile.dev` also listed workspace manifests by hand and never built the
workspace packages. Both are invisible to a project with only the template's own
workspaces and fatal to one that adds `packages/*`: npm looked for local packages on
the public registry, and the API died on MODULE_NOT_FOUND for a package whose
symlink resolved to a `dist` that was never compiled.
