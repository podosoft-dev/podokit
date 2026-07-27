import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, "..", "dist", "index.js");

type TextResult = { content: { text: string }[]; isError?: boolean };

describe("podokit-mcp server", () => {
  let client: Client;
  let transport: StdioClientTransport;
  const tmpDirs: string[] = [];

  beforeAll(async () => {
    transport = new StdioClientTransport({ command: "node", args: [server] });
    client = new Client({ name: "test", version: "0" });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client?.close();
    for (const d of tmpDirs) rmSync(dirname(d), { recursive: true, force: true });
  });

  it("registers the expected tools", async () => {
    const tools = (await client.listTools()).tools;
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "add_module",
        "check_versions",
        "create_project",
        "deployment_doctor",
        "deployment_profiles",
        "deployment_status",
        "list_local_edits",
        "list_modules",
        "list_templates",
        "initialize_deployment_profile",
        "preview_deployment",
        "preview_update",
        "project_status",
        "search_docs",
        "verify_deployment",
      ].sort(),
    );
    expect(names).not.toContain("apply_deployment");
    expect(names).not.toContain("rollback_deployment");
    expect(
      tools.find((tool) => tool.name === "preview_deployment")?.annotations?.readOnlyHint,
    ).toBe(true);
    expect(
      tools.find((tool) => tool.name === "initialize_deployment_profile")?.annotations
        ?.readOnlyHint,
    ).toBe(false);
  });

  it("create_project scaffolds a project from scratch", async () => {
    const target = mkdtempSync(join(tmpdir(), "mcp-create-")) + "/blog";
    tmpDirs.push(target);
    const r = (await client.callTool({
      name: "create_project",
      arguments: { name: "blog", template: "base", targetDir: target },
    })) as TextResult;
    expect(r.isError ?? false).toBe(false);
    expect(existsSync(join(target, "package.json"))).toBe(true);
    expect(existsSync(join(target, ".podokit"))).toBe(true);
  });

  it("list_templates lists the templates", async () => {
    const r = (await client.callTool({ name: "list_templates", arguments: {} })) as TextResult;
    expect(r.content[0].text).toContain("fullstack-nest-svelte");
    expect(r.content[0].text).toContain("base");
  });

  it("initializes and lists a repository-local deployment profile", async () => {
    const target = mkdtempSync(join(tmpdir(), "mcp-deploy-")) + "/app";
    tmpDirs.push(target);
    await client.callTool({
      name: "create_project",
      arguments: { name: "app", template: "fullstack-nest-svelte", targetDir: target },
    });
    const initialized = (await client.callTool({
      name: "initialize_deployment_profile",
      arguments: {
        profile: "production",
        context: "production",
        clusterFingerprint: `sha256:${"a".repeat(64)}`,
        host: "app.example.com",
        projectDir: target,
      },
    })) as TextResult;
    expect(initialized.isError ?? false).toBe(false);
    expect(existsSync(join(target, ".podokit", "deploy", "production.json"))).toBe(true);

    const listed = (await client.callTool({
      name: "deployment_profiles",
      arguments: { projectDir: target },
    })) as TextResult;
    expect(listed.content[0].text).toContain("context=production");
    expect(listed.content[0].text).toContain("namespace=app");
  });

  it("list_modules returns the available modules", async () => {
    const r = (await client.callTool({ name: "list_modules", arguments: {} })) as TextResult;
    expect(r.content[0].text).toContain("auth:");
    expect(r.content[0].text).toContain("admin-dashboard:");
    expect(r.content[0].text).toContain(
      "the `(admin)` route group and `admin-sidebar.svelte` are reserved for `/admin/*`",
    );
  });

  it("search_docs finds a matching section", async () => {
    const r = (await client.callTool({ name: "search_docs", arguments: { query: "DataTable" } })) as TextResult;
    expect(r.isError ?? false).toBe(false);
    expect(r.content[0].text.toLowerCase()).toContain("data table");
  });

  it("project tools fail cleanly outside a PodoKit project", async () => {
    const r = (await client.callTool({ name: "project_status", arguments: { projectDir: "/tmp" } })) as TextResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("not a PodoKit project");
  });
});
