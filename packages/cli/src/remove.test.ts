import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { create } from "./create";
import { addModule } from "./add";
import { removeModule } from "./remove";

const REPO_TEMPLATES = resolve(process.cwd(), "..", "..", "templates");
const BUNDLED = join(REPO_TEMPLATES, "modules");

const created: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "podokit-remove-"));
  created.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function generate(): string {
  const target = join(tmp(), "app");
  create({ name: "app", template: "fullstack-nest-svelte", templatesDir: REPO_TEMPLATES, targetDir: target });
  return target;
}

function readManifest(project: string): { modules: { name: string }[]; ownedGlobs: string[] } {
  return JSON.parse(readFileSync(join(project, ".podokit/manifest.json"), "utf8"));
}
function readLock(project: string): { files: Record<string, { tier: string }> } {
  return JSON.parse(readFileSync(join(project, ".podokit/files.lock"), "utf8"));
}

/** A throwaway module dir that ships one file and injects one line at a marker. */
function widgetModule(modulesDir: string, name: string, extra: Record<string, unknown> = {}): string {
  const fileRel = `apps/api/src/${name}/${name}.ts`;
  writeFile(join(modulesDir, name, "files", fileRel), `export const ${name} = true;\n`);
  writeFile(
    join(modulesDir, name, "module.manifest.json"),
    JSON.stringify({
      name,
      description: "test module",
      targetApp: "api",
      inject: [
        {
          file: "apps/api/src/app.module.ts",
          marker: "// podokit:end:providers",
          text: `// ${name}-wired`,
        },
      ],
      ...extra,
    }),
  );
  return fileRel;
}

describe("removeModule", () => {
  it("deletes overlay files, un-wires injections, and updates the manifest and lock", () => {
    const project = generate();
    const modulesDir = join(tmp(), "modules");
    const fileRel = widgetModule(modulesDir, "widget");

    addModule({ projectRoot: project, module: "widget", modulesDir });
    expect(existsSync(join(project, fileRel))).toBe(true);
    expect(readFileSync(join(project, "apps/api/src/app.module.ts"), "utf8")).toContain("// widget-wired");

    const result = removeModule({ projectRoot: project, module: "widget", modulesDir });
    expect(result.removed).toContain(fileRel);
    expect(existsSync(join(project, fileRel))).toBe(false);
    expect(existsSync(join(project, "apps/api/src/widget"))).toBe(false); // empty dir pruned
    expect(result.unwired).toContain("apps/api/src/app.module.ts");
    expect(readFileSync(join(project, "apps/api/src/app.module.ts"), "utf8")).not.toContain("// widget-wired");

    expect(readManifest(project).modules.map((m) => m.name)).not.toContain("widget");
    expect(readLock(project).files[fileRel]).toBeUndefined();
  });

  it("refuses to remove a module another installed module requires", () => {
    const project = generate();
    const modulesDir = join(tmp(), "modules");
    widgetModule(modulesDir, "base");
    widgetModule(modulesDir, "dependent", { requires: ["base"] });

    addModule({ projectRoot: project, module: "dependent", modulesDir }); // auto-adds base
    expect(readManifest(project).modules.map((m) => m.name)).toEqual(
      expect.arrayContaining(["base", "dependent"]),
    );

    expect(() => removeModule({ projectRoot: project, module: "base", modulesDir })).toThrow(/required by dependent/);
    // dependent removes fine, then base becomes removable
    removeModule({ projectRoot: project, module: "dependent", modulesDir });
    expect(() => removeModule({ projectRoot: project, module: "base", modulesDir })).not.toThrow();
  });

  it("keeps files the user edited and reports them instead of deleting", () => {
    const project = generate();
    const modulesDir = join(tmp(), "modules");
    const fileRel = widgetModule(modulesDir, "widget");
    addModule({ projectRoot: project, module: "widget", modulesDir });

    writeFileSync(join(project, fileRel), "export const widget = false; // my edit\n");
    const result = removeModule({ projectRoot: project, module: "widget", modulesDir });
    expect(result.keptEdited).toContain(fileRel);
    expect(result.removed).not.toContain(fileRel);
    expect(existsSync(join(project, fileRel))).toBe(true);
  });

  it("keeps a file another installed module also ships", () => {
    const project = generate();
    const modulesDir = join(tmp(), "modules");
    const shared = "apps/api/src/shared/shared.ts";
    for (const name of ["one", "two"]) {
      writeFile(join(modulesDir, name, "files", shared), "export const shared = 1;\n");
      writeFile(
        join(modulesDir, name, "module.manifest.json"),
        JSON.stringify({ name, description: "t", targetApp: "api" }),
      );
    }
    addModule({ projectRoot: project, module: "one", modulesDir });
    addModule({ projectRoot: project, module: "two", modulesDir });

    const result = removeModule({ projectRoot: project, module: "one", modulesDir });
    expect(result.keptShared).toContain(shared);
    expect(existsSync(join(project, shared))).toBe(true);
  });

  it("prunes deps and env the module added, keeping those another module still needs", () => {
    const project = generate();
    const modulesDir = join(tmp(), "modules");
    widgetModule(modulesDir, "solo", {
      dependencies: { "lonely-dep": "^1.0.0", "shared-dep": "^2.0.0" },
      env: ["SOLO_ONLY=1", "SHARED_ENV=1"],
    });
    widgetModule(modulesDir, "keeper", {
      dependencies: { "shared-dep": "^2.0.0" },
      env: ["SHARED_ENV=1"],
    });
    addModule({ projectRoot: project, module: "solo", modulesDir });
    addModule({ projectRoot: project, module: "keeper", modulesDir });

    removeModule({ projectRoot: project, module: "solo", modulesDir });
    const apiPkg = JSON.parse(readFileSync(join(project, "apps/api/package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(apiPkg.dependencies?.["lonely-dep"]).toBeUndefined();
    expect(apiPkg.dependencies?.["shared-dep"]).toBe("^2.0.0"); // kept — keeper needs it
    const env = readFileSync(join(project, ".env.example"), "utf8");
    expect(env).not.toContain("SOLO_ONLY=1");
    expect(env).toContain("SHARED_ENV=1");
  });

  it("errors when the module is not installed", () => {
    const project = generate();
    expect(() => removeModule({ projectRoot: project, module: "auth", modulesDir: BUNDLED })).toThrow(
      /not installed/,
    );
  });

  it("round-trips a real bundled module (add sse then remove sse)", () => {
    const project = generate();
    addModule({ projectRoot: project, module: "sse", modulesDir: BUNDLED });
    expect(existsSync(join(project, "apps/api/src/events"))).toBe(true);

    removeModule({ projectRoot: project, module: "sse", modulesDir: BUNDLED });
    expect(existsSync(join(project, "apps/api/src/events"))).toBe(false);
    expect(readManifest(project).modules.map((m) => m.name)).not.toContain("sse");
  });
});
