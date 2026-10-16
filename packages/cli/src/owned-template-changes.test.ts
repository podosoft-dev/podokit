import { afterEach, describe, expect, it } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { hashContent } from "@podosoft/podokit-template-engine";
import { create } from "./create";
import { addModule } from "./add";
import { eject } from "./eject";
import { readFilesLock, writeFilesLock } from "./lockfile";
import { applyUpdate, planUpdate, upstreamChanges } from "./update";

const REPO_TEMPLATES = resolve(process.cwd(), "..", "..", "templates");
const MCP = ".mcp.json";
const DEVCONTAINER = ".devcontainer/devcontainer.json";
const HOME_PAGE = "apps/web/src/routes/+page.svelte";

const created: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "podokit-owned-template-"));
  created.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Templates of an earlier version whose owned `.mcp.json` seed was different. */
function previousTemplates(): string {
  const dir = join(tmp(), "old-templates");
  mkdirSync(dir, { recursive: true });
  cpSync(REPO_TEMPLATES, dir, { recursive: true });
  writeFileSync(join(dir, "fullstack/dot-mcp.json"), '{ "mcpServers": { "podokit": { "command": "npx" } } }\n');
  writeFileSync(join(dir, "fullstack/apps/api/src/main.ts"), "// main.ts of an earlier version\n");
  return dir;
}

function project(templatesDir: string): string {
  const dir = join(tmp(), "app");
  mkdirSync(dir, { recursive: true });
  create({ name: "app", template: "fullstack", templatesDir, targetDir: dir });
  return dir;
}

function action(dir: string, path: string): string | undefined {
  return planUpdate(dir, REPO_TEMPLATES).changes.find((change) => change.path === path)?.action;
}

describe("owned files whose template changed", () => {
  it("records the template of every owned file at create", () => {
    const dir = project(REPO_TEMPLATES);
    const entry = readFilesLock(dir)?.files[MCP];
    expect(entry?.tier).toBe("owned");
    expect(entry?.templateHash).toBe(entry?.outHash);
  });

  it("reports an owned seed for review, never writes it, and records the new template", () => {
    const oldTemplates = previousTemplates();
    const dir = project(oldTemplates);
    const before = readFileSync(join(dir, MCP), "utf8");

    const plan = planUpdate(dir, REPO_TEMPLATES);
    expect(plan.changes.find((change) => change.path === MCP)).toMatchObject({
      tier: "owned",
      action: "review",
      note: `owned; the template changed, see podo diff ${MCP}`,
    });
    expect(plan.ownedWithoutTemplate).toEqual([]);

    const [upstream] = upstreamChanges(dir, REPO_TEMPLATES, plan, oldTemplates);
    expect(upstream?.path).toBe(MCP);
    expect(upstream?.diff).toContain('-{ "mcpServers": { "podokit": { "command": "npx" } } }');

    const result = applyUpdate(dir, REPO_TEMPLATES);
    expect(result.review).toEqual([MCP]);
    expect(result.written).not.toContain(MCP);
    expect(readFileSync(join(dir, MCP), "utf8")).toBe(before);
    const current = project(REPO_TEMPLATES);
    expect(readFilesLock(dir)?.files[MCP]?.templateHash).toBe(
      hashContent(readFileSync(join(current, MCP))),
    );
    expect(action(dir, MCP)).toBe("skip");
  });

  it("stays quiet about an edited owned file whose template did not change", () => {
    const dir = project(REPO_TEMPLATES);
    writeFileSync(join(dir, DEVCONTAINER), "{}\n");
    // The lock never tracks .podokit/, so its files are never counted either.
    writeFileSync(join(dir, ".podokit/dev.json"), '{"schemaVersion":1,"hostname":"app.localhost"}');
    writeFileSync(join(dir, HOME_PAGE), "<h1>Mine</h1>\n");
    expect(action(dir, DEVCONTAINER)).toBe("skip");
    expect(action(dir, HOME_PAGE)).toBe("skip");
    expect(planUpdate(dir, REPO_TEMPLATES).ownedWithoutTemplate).toEqual([]);
  });

  it("reports an ejected file when the template it was ejected from changes", () => {
    const dir = project(previousTemplates());
    expect(eject(dir, ["apps/api/src/main.ts"]).ejected).toEqual(["apps/api/src/main.ts"]);
    writeFileSync(join(dir, "apps/api/src/main.ts"), "// the app's own entry point\n");
    expect(action(dir, "apps/api/src/main.ts")).toBe("review");
  });

  it("counts owned files a lock without template hashes cannot judge, then records them", () => {
    const dir = project(REPO_TEMPLATES);
    writeFileSync(join(dir, HOME_PAGE), "<h1>Mine</h1>\n");
    const lock = readFilesLock(dir)!;
    for (const entry of Object.values(lock.files)) delete entry.templateHash;
    writeFilesLock(dir, lock);

    const plan = planUpdate(dir, REPO_TEMPLATES);
    expect(plan.ownedWithoutTemplate).toEqual([HOME_PAGE]);
    expect(plan.changes.find((change) => change.path === HOME_PAGE)?.action).toBe("skip");

    applyUpdate(dir, REPO_TEMPLATES);
    expect(planUpdate(dir, REPO_TEMPLATES).ownedWithoutTemplate).toEqual([]);
  });

  it("forgets the template of owned files a module wrote into and keeps the others", () => {
    const dir = project(REPO_TEMPLATES);
    addModule({ projectRoot: dir, module: "mailer", modulesDir: join(REPO_TEMPLATES, "modules") });
    const files = readFilesLock(dir)!.files;
    expect(files["AGENTS.md"]?.tier).toBe("owned");
    expect(files["AGENTS.md"]?.templateHash).toBeUndefined();
    expect(files[MCP]?.templateHash).toBe(files[MCP]?.outHash);

    applyUpdate(dir, REPO_TEMPLATES);
    expect(readFilesLock(dir)?.files["AGENTS.md"]?.templateHash).toBe(
      hashContent(readFileSync(join(dir, "AGENTS.md"))),
    );
  });
});
