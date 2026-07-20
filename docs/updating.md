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

## Updating to a newer PodoKit

`podo update` rebuilds the current PodoKit version of your project **in memory**
(from the same template, modules, and answers recorded in `.podokit/`) and
compares it to your working copy, so it can update the toolkit's files while
keeping your changes.

```bash
podo update            # dry-run: report what would change (writes nothing)
podo update --apply    # apply the changes
```

What each tier does on `--apply`:

- **managed / assembled** files you have *not* edited are updated to the new
  version. Assembled files are recomputed from the module set (the
  `// podokit:begin…end` fences are re-derived, not line-merged).
- files you *have* edited are **3-way merged**: pass the previous version's
  templates with `--from <dir>` for a real merge; without a base, an edited file
  is left untouched and reported as a conflict (never clobbered). Conflicts are
  written with standard `<<<<<<< / ======= / >>>>>>>` markers for you to resolve.
- After a clean merge, the lock keeps PodoKit's assembled file as the baseline
  rather than absorbing your merged lines. Later updates therefore continue to
  3-way merge those edits instead of treating them as replaceable generated
  output. Unrelated application files are not implicitly adopted as managed.
- **owned** files (your routes, components, shadcn UI) are never written.

Starter root layouts render the managed
`apps/web/src/lib/components/site-runtime.svelte` slot. Modules can add global
behavior such as branding and runtime themes through that component without
replacing application-owned route layouts or public pages.

The dry-run prints a per-file plan (`update` / `add` / `remove` / `conflict`) so
there are no surprises.

### Updating external package modules

External module records include `packageName` and `moduleVersion`. Upgrade the
package first, then use the same dry-run/apply flow:

```bash
npm update @podosoft/podokit-module-blog
podo update
podo update --apply
```

When a PodoKit version update also needs `--from` to merge edited managed files,
install the target external package versions before applying the update. PodoKit
uses those installed packages for the target tree and temporarily installs the
exact versions recorded in the project manifest to reconstruct the merge base:

```bash
npm update @podosoft/podokit-module-blog
podo update --apply --from <previous-podokit-templates>
```

Registry access to the recorded external versions is required only when a
3-way merge needs a previous tree. Clean updates do not fetch a merge base.

The update assembler resolves the package from the generated project's
`node_modules` and retains its root dependency declaration. If the package is
missing, update stops with a resolution error instead of silently dropping the
module.

Adding a module does not re-baseline the entire working tree. Existing managed
file drift keeps its previous hash, and unrelated application files stay outside
`files.lock`. Only module overlays, package/env merges, injection targets, and
explicitly adopted paths are added to the module baseline. This keeps a later
update from overwriting or deleting application work that happened before the
module was installed.

## Removing a module — `podo remove`

`podo remove <module>` is the inverse of `podo add`: it un-wires the module's
injections, deletes the files it added, prunes the deps/env it introduced, and
drops it from the manifest. It won't cascade (a module another one still requires
is refused), won't delete files you've edited, and never drops database tables.
See [modules.md](modules.md#removing-a-module) for the details.

## Taking ownership — `podo eject`

If you want to fully own a managed file and stop updates from touching it:

```bash
podo eject apps/api/src/main.ts
```

This flips the file's tier to `owned` and records the path in your project's
`ownedGlobs` (in `.podokit/manifest.json`), so it **stays owned** even after a
later `podo add` or `podo update` rebuilds the file tiers. It still shows up in
`podo diff`, but `podo update` will skip it from then on. Unlike a one-way
project eject, this is per-file and reversible.

### Module-owned paths

A module can declare paths it ships as **owned** up front, via `ownedGlobs` in
its `module.manifest.json`. This is how a module keeps its **public presentation
pages** freely customizable (owned) while its reusable logic under
`apps/web/src/lib/<module>/` stays **managed** and keeps receiving updates. When
you `podo add` such a module, its `ownedGlobs` are merged into your project's
`ownedGlobs`, so those files are yours to restyle and `podo update` never
touches them.

### Managed files inside owned areas

Broad areas such as `.claude/**` and `apps/web/src/routes/**` remain user-owned
by default. A module can declare `managedOverrides` for the exact workflow or
route behavior it supplies, for example
`.claude/skills/podokit-configure-auth/**` or a generated
`+page.server.ts` loader. Presentation files and the application root layout
remain owned. Managed exceptions receive normal update protection: unchanged
files update automatically, while local edits require a 3-way merge and are
never silently replaced. The exception is recorded in
`.podokit/manifest.json` and removed with the module. A file-level
`podo eject <path>` still wins over a broad managed override when an application
chooses to own that generated workflow permanently.

## Overriding providers — `app.extensions.ts`

To change how the backend behaves without editing managed code, use the owned
slot `apps/api/src/app.extensions.ts`. Export extra modules/providers, or
override a PodoKit-provided provider by its token:

```ts
// apps/api/src/app.extensions.ts
import type { Provider } from "@nestjs/common";
import { Mailer } from "./mailer/mailer";
import { MyMailer } from "./my-mailer";

export const extensionProviders: Provider[] = [
  { provide: Mailer, useClass: MyMailer },
];
```

`AppModule` spreads these in *after* the module-wired providers, so a same-token
override here wins. The file is **owned** — `podo update` never touches it. This
is the seam for swapping the mailer transport, the contact-form sink, a storage
adapter, and so on, while still receiving updates to everything else.

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
