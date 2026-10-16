import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { create } from "./create";
import { addModule } from "./add";
import { eject } from "./eject";
import { computeDrift, readFilesLock, readManifest, writeManifest } from "./lockfile";
import { planUpdate } from "./update";
import { restore, templateDiff } from "./template-files";

const REPO_TEMPLATES = resolve(process.cwd(), "..", "..", "templates");
const created: string[] = [];

function project(modules: string[] = []): string {
  const parent = mkdtempSync(join(tmpdir(), "podokit-template-files-"));
  created.push(parent);
  const dir = join(parent, "app");
  create({ name: "app", template: "fullstack", templatesDir: REPO_TEMPLATES, targetDir: dir });
  for (const module of modules) {
    addModule({ projectRoot: dir, module, modulesDir: join(REPO_TEMPLATES, "modules") });
  }
  return dir;
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const MAIN = "apps/api/src/main.ts";
const SMOKE = "tests/ui/smoke.ui.spec.ts";

describe("templateDiff", () => {
  it("shows the lines a managed file gained against the template", () => {
    const dir = project();
    writeFileSync(join(dir, MAIN), `${readFileSync(join(dir, MAIN), "utf8")}// my edit\n`);

    const [file] = templateDiff(dir, REPO_TEMPLATES, [`./${MAIN}`]).files;
    expect(file).toMatchObject({ path: MAIN, tier: "managed", status: "differs", binary: false });
    expect(file?.diff).toContain(`+++ ${MAIN}\n`);
    expect(file?.diff).toMatch(/^\+\/\/ my edit$/m);
  });

  it("reports untouched, missing, owned, and unknown files", () => {
    const dir = project();
    rmSync(join(dir, SMOKE));
    writeFileSync(join(dir, "apps/web/src/routes/+page.svelte"), "<h1>Mine</h1>\n");

    const files = templateDiff(dir, REPO_TEMPLATES, [
      MAIN,
      SMOKE,
      "apps/web/src/routes/+page.svelte",
      "notes.md",
    ]).files;
    expect(files.map((file) => [file.path, file.tier, file.status])).toEqual([
      [MAIN, "managed", "same"],
      [SMOKE, "managed", "missing"],
      ["apps/web/src/routes/+page.svelte", "owned", "differs"],
      ["notes.md", null, "not-generated"],
    ]);
    expect(files[2]?.diff).toMatch(/^\+<h1>Mine<\/h1>$/m);
  });

  it("refuses a path outside the project", () => {
    const dir = project();
    expect(() => templateDiff(dir, REPO_TEMPLATES, ["../outside.ts"])).toThrow(/outside the project/);
  });
});

describe("restore", () => {
  it("rewrites an edited or deleted managed file and records it as clean", () => {
    const dir = project();
    const template = readFileSync(join(dir, MAIN), "utf8");
    writeFileSync(join(dir, MAIN), `${template}// my edit\n`);
    rmSync(join(dir, SMOKE));
    expect(computeDrift(dir)).toEqual({ drifted: [MAIN], missing: [SMOKE] });

    expect(restore(dir, REPO_TEMPLATES, [MAIN, SMOKE])).toEqual({
      restored: [MAIN, SMOKE],
      remanaged: [],
    });
    expect(readFileSync(join(dir, MAIN), "utf8")).toBe(template);
    expect(existsSync(join(dir, SMOKE))).toBe(true);
    expect(computeDrift(dir)).toEqual({ drifted: [], missing: [] });
  });

  it("hands an ejected file back to PodoKit so updates manage it again", () => {
    const dir = project();
    expect(eject(dir, [SMOKE]).ejected).toEqual([SMOKE]);
    writeFileSync(join(dir, SMOKE), "// the app's own smoke test\n");
    expect(planUpdate(dir, REPO_TEMPLATES).changes.find((change) => change.path === SMOKE)).toMatchObject({
      tier: "owned",
      action: "skip",
    });

    expect(restore(dir, REPO_TEMPLATES, [SMOKE])).toEqual({ restored: [SMOKE], remanaged: [SMOKE] });
    expect(readManifest(dir)?.ownedGlobs).not.toContain(SMOKE);
    expect(readFilesLock(dir)?.files[SMOKE]?.tier).toBe("managed");
    expect(readFileSync(join(dir, SMOKE), "utf8")).toContain("app is reachable");
    expect(planUpdate(dir, REPO_TEMPLATES).changes.find((change) => change.path === SMOKE)).toMatchObject({
      tier: "managed",
      action: "up-to-date",
    });
  });

  it("re-manages an ejected route loader that a module keeps managed", () => {
    const dir = project(["admin-dashboard"]);
    const loader = "apps/web/src/routes/account/+page.server.ts";
    expect(eject(dir, [loader]).ejected).toEqual([loader]);
    writeFileSync(join(dir, loader), "export const load = () => ({});\n");

    expect(restore(dir, REPO_TEMPLATES, [loader]).remanaged).toEqual([loader]);
    expect(readFilesLock(dir)?.files[loader]?.tier).toBe("managed");
    expect(readManifest(dir)?.ownedGlobs).not.toContain(loader);
  });

  it("refuses owned files the template or a module declares, and writes nothing", () => {
    const dir = project(["admin-dashboard"]);
    const edited = `${readFileSync(join(dir, MAIN), "utf8")}// my edit\n`;
    writeFileSync(join(dir, MAIN), edited);
    const lockBefore = readFileSync(join(dir, ".podokit/files.lock"), "utf8");

    expect(() => restore(dir, REPO_TEMPLATES, [MAIN, "apps/web/src/routes/+page.svelte"])).toThrow(
      /owned by the application/,
    );
    expect(() => restore(dir, REPO_TEMPLATES, ["apps/web/src/lib/server/public-paths.ts"])).toThrow(
      /owned by the application/,
    );
    expect(() => restore(dir, REPO_TEMPLATES, ["notes.md"])).toThrow(/does not generate notes.md/);
    expect(readFileSync(join(dir, MAIN), "utf8")).toBe(edited);
    expect(readFileSync(join(dir, ".podokit/files.lock"), "utf8")).toBe(lockBefore);
    expect(readManifest(dir)?.ownedGlobs).toContain("apps/web/src/lib/server/public-paths.ts");
  });

  it("refuses to mix template versions", () => {
    const dir = project();
    const manifest = readManifest(dir)!;
    writeManifest(dir, { ...manifest, podokitVersion: "0.0.1" });
    expect(() => restore(dir, REPO_TEMPLATES, [MAIN])).toThrow(/Run podo update --apply first/);
  });
});
