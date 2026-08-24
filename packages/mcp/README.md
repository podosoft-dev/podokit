# @podosoft/podokit-mcp

A local [Model Context Protocol](https://modelcontextprotocol.io) server for
**PodoKit** projects. It runs on your machine via `npx` (Node) or `bunx`
(Bun) — no hosting, no
account, no separate server — and gives AI coding tools (Claude Code, Cursor, …)
first-class access to `podo` tooling and the PodoKit conventions.

## Use it

Generated PodoKit projects already ship a `.mcp.json`:

```json
{ "mcpServers": { "podokit": { "command": "npx", "args": ["-y", "@podosoft/podokit-mcp"] } } }
```

Bun-based configurations use the equivalent `bunx` command.

Your editor/agent spawns the server on demand and talks to it over stdio.

## Tools

| Tool | Does |
|---|---|
| `list_templates` | List the project templates (`fullstack`, `todo`, `base`). |
| `create_project` | **Scaffold a Bun 1.4.0 project from scratch** (`podo create`). |
| `list_modules` | List the feature modules you can add (`podo add`). |
| `add_module` | Add a module — overlays files, merges deps, wires it in. |
| `project_status` | Version, modules, file tiers, and your local edits (`podo status`). |
| `list_local_edits` | Managed files you've edited/deleted (`podo diff`). |
| `check_versions` | Framework versions vs the supported ranges (`podo doctor`). |
| `preview_update` | Preview what an update would change (`podo update` dry-run). |
| `initialize_deployment_profile` | Create a repository-local deployment profile without changing a cluster. |
| `deployment_profiles` | List deployment targets and non-secret metadata. |
| `deployment_doctor` | Check the explicit cluster, namespace, Helm, storage, and Secret key names without returning Secret values. |
| `preview_deployment` | Render and hash an immutable release plan without applying it. |
| `deployment_status` | Read Helm revision, images, ready replicas, and restart totals. |
| `verify_deployment` | Run the profile's read-only public HTTP checks. |
| `search_docs` | Search the bundled PodoKit docs/conventions. |

Project tools default to the current directory; pass `projectDir` to target another.

The MCP server intentionally does not expose deployment apply or rollback
mutations. An agent can inspect and preview with MCP, then use the CLI only after
the user explicitly approves the exact plan hash.

## Start a project from scratch with an AI agent

Register the server **globally** (user scope) so it's available before any
project exists:

```bash
# Node
claude mcp add --scope user podokit -- npx -y @podosoft/podokit-mcp
# Bun
claude mcp add --scope user podokit -- bunx @podosoft/podokit-mcp
```

Then, in an empty folder, ask your agent:

> "Create a fullstack PodoKit app called `blog` with auth and admin-dashboard."

The agent calls `list_templates` → `create_project` → `add_module` (auth,
admin-dashboard), then installs with Bun — a working starter in one step.

## License

[Apache-2.0](https://github.com/podosoft-dev/podokit/blob/main/LICENSE)
