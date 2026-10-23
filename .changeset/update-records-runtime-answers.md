---
"@podosoft/podokit": patch
---

`podo update --apply` records the new Bun release in the manifest's template answers as well as its toolchain. Before, `answers.runtimeVersion` kept the version the project was created with, so the manifest named two different Bun releases. The updating guide now says that `Dockerfile.dev` is owned by the project and needs its `oven/bun` tags changed by hand.
