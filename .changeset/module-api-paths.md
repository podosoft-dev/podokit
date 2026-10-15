---
"@podosoft/podokit": minor
---

Let modules declare direct API paths. A manifest v4 module lists prefixes under `/api/` in `apiPaths`, validated like `exposure.apiPaths`, and `podo add` appends them to `.podokit/dev.json` and to `exposure.apiPaths` in every deployment profile, keeping the other keys and the file's indentation, skipping paths an entry already covers, and reporting paths it cannot add (an overlap, a covered WebSocket path, or Kubernetes `nodePort` exposure) instead of writing an invalid file. The project manifest records them as the module's `appliedApiPaths`; `podo deploy init` copies them into new profiles, `podo remove` deletes the ones no other installed module declares, and `podo update` plans and applies the paths a newer module version adds. The `file-upload` module declares `/api/files/uploads/`.
