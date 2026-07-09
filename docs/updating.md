# Updating a generated project

Every project created by `podo create` records how it was assembled in a
`.podokit/` directory (committed to your repo):

- `.podokit/manifest.json` — PodoKit version, template, package manager, the
  answers used to render it, and the modules you added.
- `.podokit/files.lock` — every file's ownership tier and a content hash of what
  PodoKit last wrote, so local edits are detectable.

## Ownership tiers

| Tier | Meaning | Example |
|---|---|---|
| **managed** | PodoKit owns it | `apps/api/src/main.ts`, config |
| **assembled** | base + module wiring, inside `// podokit:begin…end` fences | `apps/api/src/app.module.ts`, `auth/auth.ts` |
| **owned** | yours — never touched by tooling | `apps/web/src/routes/**`, `apps/web/src/lib/components/ui/**`, your code |

## Read-only commands

Run these inside a generated project:

- `podo status` — PodoKit version, applied modules, file-tier counts, and how
  many managed files you have edited.
- `podo diff` — lists the PodoKit-managed files you have edited since
  generation. Files in the `owned` tier are never reported.
- `podo doctor` — checks the framework versions your app declares against the
  ranges the matching PodoKit line supports.

## Framework compatibility

PodoKit ships its reusable pieces as `@podosoft/*` packages that plug into the
frameworks your app owns. Keep those frameworks within the supported range so
the extensions match:

| Framework | Supported range |
|---|---|
| `@nestjs/*` | `^11` |
| `svelte` | `^5` |
| `better-auth` | `>=1.6.23 <1.7` |

`podo doctor` warns when a framework moves outside its range.
