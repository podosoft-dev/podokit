#!/usr/bin/env node
// PodoKit MCP server (stdio). Wraps the `podo` CLI library + docs so AI coding
// tools can list/add modules, inspect a project, preview updates, and search
// the conventions — run locally via `npx @podosoft/podokit-mcp` (no hosting).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addModule,
  builtinModulesDir,
  builtinTemplatesDir,
  diff,
  doctor,
  listModules,
  planUpdate,
  status,
  summarize,
} from "@podosoft/podokit";

const here = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(here, "docs");

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });
const fail = (t: string): ToolResult => ({ content: [{ type: "text", text: t }], isError: true });

/** Run a body that reads a PodoKit project, turning errors into tool errors. */
function inProject<T>(projectDir: string | undefined, body: (dir: string) => T): T | ToolResult {
  const dir = projectDir || process.cwd();
  if (!existsSync(join(dir, ".podokit"))) {
    return fail(`${dir} is not a PodoKit project (no .podokit/). Run this from a generated app, or pass projectDir.`);
  }
  try {
    return body(dir);
  } catch (err) {
    return fail(`Failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const projectDirSchema = { projectDir: z.string().optional().describe("Project root; defaults to the current directory") };

const server = new McpServer({ name: "podokit", version: "0.1.0" });

server.registerTool(
  "list_modules",
  { description: "List the PodoKit feature modules available to add to a project (the choices for `podo add`)." },
  async () => {
    const modules = listModules(builtinModulesDir());
    return text(modules.map((m) => `- ${m.name}: ${m.description}`).join("\n"));
  },
);

server.registerTool(
  "project_status",
  {
    description:
      "Report a generated project's PodoKit version, installed modules, file ownership tiers, and which managed files the user has edited (= `podo status`).",
    inputSchema: projectDirSchema,
  },
  async ({ projectDir }) => {
    const r = inProject(projectDir, (dir) => status(dir));
    return "content" in r ? r : text(JSON.stringify(r, null, 2));
  },
);

server.registerTool(
  "list_local_edits",
  {
    description: "List the PodoKit-managed files the user has edited or deleted since generation (= `podo diff`).",
    inputSchema: projectDirSchema,
  },
  async ({ projectDir }) => {
    const r = inProject(projectDir, (dir) => diff(dir));
    return "content" in r
      ? r
      : text(`edited: ${r.drifted.join(", ") || "(none)"}\nmissing: ${r.missing.join(", ") || "(none)"}`);
  },
);

server.registerTool(
  "check_versions",
  {
    description:
      "Check the project's framework versions (NestJS, SvelteKit, …) against the ranges PodoKit supports (= `podo doctor`).",
    inputSchema: projectDirSchema,
  },
  async ({ projectDir }) => {
    const r = inProject(projectDir, (dir) => doctor(dir));
    if ("content" in r) return r;
    if (r.length === 0) return text("No frameworks to check.");
    return text(
      r.map((f) => `[${f.ok ? "ok" : "WARN"}] ${f.package}: installed ${f.installed}, supported ${f.supported}`).join("\n"),
    );
  },
);

server.registerTool(
  "preview_update",
  {
    description:
      "Preview what updating the project to this PodoKit version would change, without applying it (= `podo update` dry-run).",
    inputSchema: projectDirSchema,
  },
  async ({ projectDir }) => {
    const r = inProject(projectDir, (dir) => {
      const plan = planUpdate(dir, builtinTemplatesDir());
      return { plan, counts: summarize(plan) };
    });
    if ("content" in r) return r;
    const { plan, counts } = r;
    return text(
      `${plan.fromVersion} -> ${plan.toVersion} (template: ${plan.template})\n` +
        `changes: ${JSON.stringify(counts)}\n` +
        plan.changes.map((c) => `  ${c.action}\t${c.path}`).join("\n"),
    );
  },
);

server.registerTool(
  "add_module",
  {
    description:
      "Add a PodoKit feature module to the project — overlays files, merges dependencies, and wires it in (= `podo add <module>`). This edits files; run `list_modules` first.",
    inputSchema: {
      module: z.string().describe("Module name, e.g. auth, admin-dashboard, redis"),
      projectDir: z.string().optional(),
    },
  },
  async ({ module, projectDir }) => {
    const r = inProject(projectDir, (dir) => addModule({ projectRoot: dir, module, modulesDir: builtinModulesDir() }));
    return "content" in r
      ? r
      : text(`Added ${r.module}. Also added: ${r.added.join(", ") || "(none)"}. Run npm install.`);
  },
);

server.registerTool(
  "search_docs",
  {
    description: "Search the PodoKit documentation and conventions for a keyword (returns matching sections).",
    inputSchema: { query: z.string().describe("Keyword or phrase, e.g. DataTable, error envelope, ports") },
  },
  async ({ query }) => {
    if (!existsSync(DOCS_DIR)) return fail("Docs not bundled in this build.");
    const q = query.toLowerCase();
    const hits: string[] = [];
    for (const file of readdirSync(DOCS_DIR).filter((f) => f.endsWith(".md"))) {
      const content = readFileSync(join(DOCS_DIR, file), "utf8");
      for (const section of content.split(/\n(?=#{1,3} )/)) {
        if (section.toLowerCase().includes(q)) {
          hits.push(`### ${file}\n${section.trim().slice(0, 800)}`);
          if (hits.length >= 8) break;
        }
      }
      if (hits.length >= 8) break;
    }
    return text(hits.length ? hits.join("\n\n---\n\n") : `No docs matched "${query}".`);
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
