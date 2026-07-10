# @podosoft/podokit-mcp

A local [Model Context Protocol](https://modelcontextprotocol.io) server for
**PodoKit** projects. It runs on your machine via `npx` — no hosting, no
account, no separate server — and gives AI coding tools (Claude Code, Cursor, …)
first-class access to `podo` tooling and the PodoKit conventions.

## Use it

Generated PodoKit projects already ship a `.mcp.json`:

```json
{ "mcpServers": { "podokit": { "command": "npx", "args": ["-y", "@podosoft/podokit-mcp"] } } }
```

Your editor/agent spawns the server on demand and talks to it over stdio.

## Tools

| Tool | Does |
|---|---|
| `list_modules` | List the feature modules you can add (`podo add`). |
| `add_module` | Add a module — overlays files, merges deps, wires it in. |
| `project_status` | Version, modules, file tiers, and your local edits (`podo status`). |
| `list_local_edits` | Managed files you've edited/deleted (`podo diff`). |
| `check_versions` | Framework versions vs the supported ranges (`podo doctor`). |
| `preview_update` | Preview what an update would change (`podo update` dry-run). |
| `search_docs` | Search the bundled PodoKit docs/conventions. |

Project tools default to the current directory; pass `projectDir` to target another.

## License

[Apache-2.0](https://github.com/podosoft-dev/podokit/blob/main/LICENSE)
