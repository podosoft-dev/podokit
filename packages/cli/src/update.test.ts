import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { create } from "./create";
import { addModule } from "./add";
import { assembleProject } from "./assemble";
import { planUpdate, summarize } from "./update";

const REPO_TEMPLATES = resolve(process.cwd(), "..", "..", "templates");

const created: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "podokit-update-"));
  created.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("assembleProject", () => {
  it("matches what create+add write to disk (app.module wiring)", () => {
    const onDisk = join(tmp(), "app");
    create({ name: "app", template: "fullstack-nest-svelte", templatesDir: REPO_TEMPLATES, targetDir: onDisk });
    addModule({ projectRoot: onDisk, module: "auth", modulesDir: join(REPO_TEMPLATES, "modules") });

    const tree = assembleProject({
      templatesDir: REPO_TEMPLATES,
      template: "fullstack-nest-svelte",
      answers: { projectName: "app", packageManager: "npm" },
      modules: ["auth"],
    });

    const diskAppModule = readFileSync(join(onDisk, "apps/api/src/app.module.ts"), "utf8");
    expect(String(tree.get("apps/api/src/app.module.ts")?.content)).toBe(diskAppModule);
  });
});

describe("planUpdate (dry-run)", () => {
  it("reports everything up to date for a same-version project", () => {
    const dir = join(tmp(), "app");
    create({ name: "app", template: "fullstack-nest-svelte", templatesDir: REPO_TEMPLATES, targetDir: dir });
    const plan = planUpdate(dir, REPO_TEMPLATES);
    const counts = summarize(plan);
    expect(counts.update).toBe(0);
    expect(counts.conflict).toBe(0);
    expect(counts["up-to-date"]).toBeGreaterThan(0);
  });

  it("flags a user-edited managed file as a conflict", () => {
    const dir = join(tmp(), "app");
    create({ name: "app", template: "fullstack-nest-svelte", templatesDir: REPO_TEMPLATES, targetDir: dir });
    // edit a managed file
    const mainPath = join(dir, "apps/api/src/main.ts");
    writeFileSync(mainPath, readFileSync(mainPath, "utf8") + "\n// my edit\n");

    const plan = planUpdate(dir, REPO_TEMPLATES);
    const change = plan.changes.find((c) => c.path === "apps/api/src/main.ts");
    expect(change?.action).toBe("conflict");
  });

  it("never reports owned files as changes to write", () => {
    const dir = join(tmp(), "app");
    create({ name: "app", template: "todo", templatesDir: REPO_TEMPLATES, targetDir: dir });
    // edit an owned (route) file
    const page = join(dir, "apps/web/src/routes/+page.svelte");
    writeFileSync(page, "<h1>changed</h1>");
    const plan = planUpdate(dir, REPO_TEMPLATES);
    const change = plan.changes.find((c) => c.path === "apps/web/src/routes/+page.svelte");
    expect(change?.action).toBe("skip");
  });
});
