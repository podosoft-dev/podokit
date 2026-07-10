# @podosoft/podokit-template-engine

Template utilities used by the [PodoKit](https://github.com/podosoft-dev/podokit) CLI: token rendering, recursive template copying, and `package.json` merging.

> This package is primarily an internal building block for `@podosoft/podokit`. It is published so the CLI is installable from the registry, but the API is small and reusable on its own.

## Install

```bash
npm install @podosoft/podokit-template-engine
```

## API

```ts
import {
  renderTokens,
  copyTemplate,
  mergePackageJson,
  resolveOutputName,
} from "@podosoft/podokit-template-engine";
```

### `renderTokens(content, vars)`

Replace `{{key}}` tokens with values from `vars`. Unknown tokens are left untouched.

```ts
renderTokens("# {{name}}", { name: "my-app" }); // "# my-app"
```

### `copyTemplate(srcDir, destDir, vars)`

Recursively copy a template directory, rendering tokens in text files. Files named `dot-<x>` are written as `.<x>` (so `dot-gitignore` → `.gitignore`), which lets templates ship files that npm would otherwise strip.

### `mergePackageJson(base, overlay)`

Deep-merge two `package.json`-shaped objects: objects merge recursively, arrays concatenate and de-duplicate, and scalar overlay values win. Neither input is mutated.

### `resolveOutputName(name)`

Map a template file name to its output name (applies the `dot-` convention).

### Assembly & update primitives

These back `podo update` — assembling a project in memory and reconciling it
with a working copy:

- `renderTemplate(srcDir, vars)` / `writeTree(tree, destDir)` — render a template
  to an in-memory tree (`VfsTree`) and write a tree to disk.
- `hashContent(content)` — stable `sha256:` hash used by the generation lockfile.
- `insertAtMarker` / `removeAtMarker` — idempotently add/remove a wiring line at a
  `// podokit:` marker.
- `extractRegion` / `replaceRegion` — read and rewrite the body of a
  `// podokit:begin:<name>` … `// podokit:end:<name>` fenced region.
- `threeWayMerge(base, current, next)` — diff3 line merge with git-style conflict
  markers.

## License

[Apache-2.0](https://github.com/podosoft-dev/podokit/blob/main/LICENSE)
