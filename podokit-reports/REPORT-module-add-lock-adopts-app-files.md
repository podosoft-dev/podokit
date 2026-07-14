# Adding a module absorbs application files into the generated lock baseline

## Summary
`podo add` recomputes `files.lock` from the entire working tree. Existing local edits can therefore become the new generated baseline, and unrelated application files can become managed. A later `podo update --apply` may overwrite those edits or remove those files.

## Environment
- PodoKit / CLI version: `@podosoft/podokit` 0.9.0, local source build
- Template: `fullstack-nest-svelte`
- Modules added: `blog` external package, with `rate-limit` added as a requirement
- Run mode: containerized `compose.dev.yaml`
- OS / Node / package manager: macOS 26.5.1 / Node 25.8.1 / npm 11.17.0

## Steps to reproduce
1. Create a `fullstack-nest-svelte` app and add `auth` and `admin-dashboard`.
2. Edit an assembled file outside its injection fences, such as adding an application message import to `apps/web/src/lib/i18n/messages.ts`.
3. Add an unrelated application file that is not covered by an owned glob, such as `apps/web/src/lib/application-seo.ts`.
4. Install an external package module and run `podo add <module> --adopt`.
5. Upgrade or change the installed module package and run `podo update --apply`.

## Expected
The add operation should baseline only files it safely wrote. It should preserve the previous hash for an already edited managed or assembled file, and unrelated application files should remain outside `files.lock`.

## Actual
The add operation hashes the complete working tree as generated output. In the observed consumer app, the next update reported:

```text
Applied: 7 written, 26 removed, 0 merged, 1 conflict.
```

An application message import was overwritten, and unrelated application migrations, an SEO helper, a logo, and performance tests were removed. The removed files were recovered byte-for-byte from the pre-update container image.

## Evidence
- `apps/web/src/lib/i18n/messages.ts` lost the existing `publicSite` import and catalog entries.
- `apps/web/package.json` lost existing application dependencies.
- Unrelated files not present in the assembled PodoKit tree were removed during update.
- A regression test now demonstrates that pre-existing drift keeps its prior hash and an unrelated file remains absent from `files.lock` after add.

## Suspected root cause / suggested fix (optional)
`recordModules` called `computeFilesLock` after module application and accepted every on-disk hash and path. Capture the previous lock before writing, preserve old baselines for paths that were already drifted, add only explicit module paths that were not previously tracked, and keep unrelated files out of the lock. External package dependencies in the root `package.json` also need to be replayed while assembling updates so the update does not remove the module package itself.
