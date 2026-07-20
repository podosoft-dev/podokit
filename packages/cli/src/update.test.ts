import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, cpSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { create } from "./create";
import { addModule } from "./add";
import { assembleProject } from "./assemble";
import { planUpdate, applyUpdate, summarize } from "./update";
import { readFilesLock } from "./lockfile";

const REPO_TEMPLATES = resolve(process.cwd(), "..", "..", "templates");
const ADMIN_DASHBOARD_MANAGED_ROUTE_LOADERS = [
  "apps/web/src/routes/(app)/+layout.server.ts",
  "apps/web/src/routes/(app)/admin/account/+page.server.ts",
  "apps/web/src/routes/(app)/admin/audit/+page.server.ts",
  "apps/web/src/routes/(app)/admin/organizations/+page.server.ts",
  "apps/web/src/routes/(app)/admin/sessions/+page.server.ts",
  "apps/web/src/routes/(app)/admin/settings/+page.server.ts",
  "apps/web/src/routes/(app)/admin/users/+page.server.ts",
  "apps/web/src/routes/(auth)/login/+page.server.ts",
  "apps/web/src/routes/(auth)/signup/+page.server.ts",
  "apps/web/src/routes/account/+page.server.ts",
  "apps/web/src/routes/setup-2fa/+page.server.ts",
];

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

describe("external module updates", () => {
  it("replays an installed package module and records its applied version", () => {
    const project = join(tmp(), "app");
    create({ name: "app", template: "fullstack-nest-svelte", templatesDir: REPO_TEMPLATES, targetDir: project });
    const packageDir = join(project, "node_modules/@podosoft/podokit-module-blog");
    const rootPackagePath = join(project, "package.json");
    const rootPackage = JSON.parse(readFileSync(rootPackagePath, "utf8")) as {
      devDependencies?: Record<string, string>;
    };
    rootPackage.devDependencies = {
      ...rootPackage.devDependencies,
      "@podosoft/podokit-module-blog": "^0.1.0",
    };
    writeFileSync(rootPackagePath, `${JSON.stringify(rootPackage, null, 2)}\n`);
    const fileRel = "apps/api/src/blog/external.ts";
    mkdirSync(join(packageDir, "files/apps/api/src/blog"), { recursive: true });
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "@podosoft/podokit-module-blog", version: "0.1.0" }),
    );
    writeFileSync(
      join(packageDir, "module.manifest.json"),
      JSON.stringify({ manifestVersion: 1, name: "blog", description: "test", targetApp: "api" }),
    );
    writeFileSync(join(packageDir, "files", fileRel), "export const version = 1;\n");

    addModule({ projectRoot: project, module: "blog", modulesDir: join(REPO_TEMPLATES, "modules") });
    const before = JSON.parse(readFileSync(join(project, ".podokit/manifest.json"), "utf8")) as {
      modules: { name: string; packageName?: string; moduleVersion?: string }[];
    };
    expect(before.modules.find((module) => module.name === "blog")).toMatchObject({
      packageName: "@podosoft/podokit-module-blog",
      moduleVersion: "0.1.0",
    });

    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "@podosoft/podokit-module-blog", version: "0.2.0" }),
    );
    writeFileSync(join(packageDir, "files", fileRel), "export const version = 2;\n");

    const plan = planUpdate(project, REPO_TEMPLATES);
    expect(plan.changes.find((change) => change.path === fileRel)?.action).toBe("update");
    expect(plan.changes.find((change) => change.path === "package.json")?.action).toBe("up-to-date");
    applyUpdate(project, REPO_TEMPLATES, { oldTemplatesDir: REPO_TEMPLATES });
    expect(readFileSync(join(project, fileRel), "utf8")).toContain("version = 2");
    const after = JSON.parse(readFileSync(join(project, ".podokit/manifest.json"), "utf8")) as {
      modules: { name: string; moduleVersion?: string }[];
    };
    expect(after.modules.find((module) => module.name === "blog")?.moduleVersion).toBe("0.2.0");
  });

  it("replays the recorded external module version for the merge base", () => {
    const project = join(tmp(), "app");
    create({ name: "app", template: "fullstack-nest-svelte", templatesDir: REPO_TEMPLATES, targetDir: project });
    const packageDir = join(project, "node_modules/@podosoft/podokit-module-blog");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "@podosoft/podokit-module-blog", version: "0.1.0" }),
    );
    writeFileSync(
      join(packageDir, "module.manifest.json"),
      JSON.stringify({ manifestVersion: 1, name: "blog", description: "test", targetApp: "api" }),
    );
    addModule({ projectRoot: project, module: "blog", modulesDir: join(REPO_TEMPLATES, "modules") });

    const mainPath = join(project, "apps/api/src/main.ts");
    writeFileSync(mainPath, `${readFileSync(mainPath, "utf8")}\n// application edit\n`);
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "@podosoft/podokit-module-blog", version: "0.2.0" }),
    );

    const previousRoot = join(tmp(), "previous-modules");
    const previousPackageDir = join(previousRoot, "node_modules/@podosoft/podokit-module-blog");
    mkdirSync(previousPackageDir, { recursive: true });
    writeFileSync(join(previousRoot, "package.json"), JSON.stringify({ name: "previous-modules", private: true }));
    writeFileSync(
      join(previousPackageDir, "package.json"),
      JSON.stringify({ name: "@podosoft/podokit-module-blog", version: "0.1.0" }),
    );
    writeFileSync(
      join(previousPackageDir, "module.manifest.json"),
      JSON.stringify({ manifestVersion: 1, name: "blog", description: "test", targetApp: "api" }),
    );

    const result = applyUpdate(project, REPO_TEMPLATES, {
      oldTemplatesDir: REPO_TEMPLATES,
      oldExternalModulesRoot: previousRoot,
    });
    expect(result.merged).toContain("apps/api/src/main.ts");
    expect(readFileSync(mainPath, "utf8")).toContain("// application edit");
    const manifest = JSON.parse(readFileSync(join(project, ".podokit/manifest.json"), "utf8")) as {
      modules: { name: string; moduleVersion?: string }[];
    };
    expect(manifest.modules.find((module) => module.name === "blog")?.moduleVersion).toBe("0.2.0");
  });
});

describe("applyUpdate", () => {
  // Build an "old" template set (a copy) and mutate the live templates so there
  // is a real version delta to apply.
  function oldTemplatesCopy(): string {
    const dir = join(tmp(), "old-templates");
    mkdirSync(dir, { recursive: true });
    cpSync(REPO_TEMPLATES, dir, { recursive: true });
    return dir;
  }

  it("promotes newly declared module-owned paths during update", () => {
    const oldTemplates = oldTemplatesCopy();
    const newTemplates = oldTemplatesCopy();
    const newManifestPath = join(newTemplates, "modules/admin-dashboard/module.manifest.json");
    const newManifest = JSON.parse(readFileSync(newManifestPath, "utf8")) as { ownedGlobs?: string[] };
    const ownedFile = "apps/api/src/site-settings/site-settings.service.ts";
    newManifest.ownedGlobs = [...(newManifest.ownedGlobs ?? []), ownedFile];
    writeFileSync(newManifestPath, `${JSON.stringify(newManifest, null, 2)}\n`);

    const dir = join(tmp(), "app");
    create({ name: "app", template: "fullstack-nest-svelte", templatesDir: oldTemplates, targetDir: dir });
    addModule({ projectRoot: dir, module: "admin-dashboard", modulesDir: join(oldTemplates, "modules") });

    expect(readFilesLock(dir)?.files[ownedFile]?.tier).toBe("managed");
    expect(planUpdate(dir, newTemplates).changes.find((change) => change.path === ownedFile)?.action).toBe("skip");

    applyUpdate(dir, newTemplates);
    expect(readFilesLock(dir)?.files[ownedFile]?.tier).toBe("owned");
    const manifest = JSON.parse(readFileSync(join(dir, ".podokit/manifest.json"), "utf8")) as {
      ownedGlobs: string[];
    };
    expect(manifest.ownedGlobs).toContain(ownedFile);
  });

  it("promotes newly declared default-owned paths during update", () => {
    const dir = join(tmp(), "app");
    create({ name: "app", template: "fullstack-nest-svelte", templatesDir: REPO_TEMPLATES, targetDir: dir });
    const manifestPath = join(dir, ".podokit/manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { ownedGlobs: string[] };
    manifest.ownedGlobs = manifest.ownedGlobs.filter((glob) => glob !== ".podokit/dev.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const devConfigPath = join(dir, ".podokit/dev.json");
    writeFileSync(devConfigPath, '{"schemaVersion":1,"hostname":"custom.localhost"}\n');

    expect(planUpdate(dir, REPO_TEMPLATES).changes.find((change) => change.path === ".podokit/dev.json")?.action).toBe("skip");

    applyUpdate(dir, REPO_TEMPLATES);
    const refreshed = JSON.parse(readFileSync(manifestPath, "utf8")) as { ownedGlobs: string[] };
    expect(refreshed.ownedGlobs).toContain(".podokit/dev.json");
    expect(readFileSync(devConfigPath, "utf8")).toContain("custom.localhost");
  });

  it("promotes a module skill from owned to managed during update", () => {
    const oldTemplates = oldTemplatesCopy();
    const oldAuthManifestPath = join(oldTemplates, "modules/auth/module.manifest.json");
    const oldAuthManifest = JSON.parse(readFileSync(oldAuthManifestPath, "utf8")) as {
      managedOverrides?: string[];
    };
    delete oldAuthManifest.managedOverrides;
    writeFileSync(oldAuthManifestPath, `${JSON.stringify(oldAuthManifest, null, 2)}\n`);
    const oldSkillPath = join(
      oldTemplates,
      "modules/auth/files/dot-claude/skills/podokit-configure-auth/SKILL.md",
    );
    writeFileSync(oldSkillPath, "---\nname: podokit-configure-auth\ndescription: Old skill.\n---\n\n# Old skill\n");
    rmSync(
      join(
        oldTemplates,
        "modules/auth/files/dot-claude/skills/podokit-configure-auth/references/bootstrap-admin.md",
      ),
    );

    const dir = join(tmp(), "app");
    create({ name: "app", template: "fullstack-nest-svelte", templatesDir: oldTemplates, targetDir: dir });
    addModule({ projectRoot: dir, module: "auth", modulesDir: join(oldTemplates, "modules") });
    const skill = ".claude/skills/podokit-configure-auth/SKILL.md";
    expect(readFilesLock(dir)?.files[skill]?.tier).toBe("owned");

    const plan = planUpdate(dir, REPO_TEMPLATES);
    expect(plan.changes.find((change) => change.path === skill)?.action).toBe("update");
    expect(
      plan.changes.find(
        (change) =>
          change.path ===
          ".claude/skills/podokit-configure-auth/references/bootstrap-admin.md",
      )?.action,
    ).toBe("add");

    const result = applyUpdate(dir, REPO_TEMPLATES, { oldTemplatesDir: oldTemplates });
    expect(result.written).toContain(skill);
    expect(readFilesLock(dir)?.files[skill]?.tier).toBe("managed");
    const manifest = JSON.parse(readFileSync(join(dir, ".podokit/manifest.json"), "utf8")) as {
      managedOverrides?: string[];
    };
    expect(manifest.managedOverrides).toContain(
      ".claude/skills/podokit-configure-auth/**",
    );
  });

  it("promotes pristine module route loaders from owned to managed", () => {
    const oldTemplates = oldTemplatesCopy();
    const oldManifestPath = join(oldTemplates, "modules/admin-dashboard/module.manifest.json");
    const oldManifest = JSON.parse(readFileSync(oldManifestPath, "utf8")) as {
      managedOverrides?: string[];
    };
    delete oldManifest.managedOverrides;
    writeFileSync(oldManifestPath, `${JSON.stringify(oldManifest, null, 2)}\n`);

    const oldUsersLoaderPath = join(
      oldTemplates,
      "modules/admin-dashboard/files/apps/web/src/routes/(app)/admin/users/+page.server.ts",
    );
    writeFileSync(
      oldUsersLoaderPath,
      readFileSync(oldUsersLoaderPath, "utf8").replace(
        "requireAdmin(locals.user, locals);",
        "requireAdmin(locals.user);",
      ),
    );

    const project = join(tmp(), "app");
    create({
      name: "app",
      template: "fullstack-nest-svelte",
      templatesDir: oldTemplates,
      targetDir: project,
    });
    addModule({
      projectRoot: project,
      module: "admin-dashboard",
      modulesDir: join(oldTemplates, "modules"),
    });

    const usersLoader = "apps/web/src/routes/(app)/admin/users/+page.server.ts";
    expect(readFilesLock(project)?.files[usersLoader]?.tier).toBe("owned");
    expect(readFilesLock(project)?.files["apps/web/src/routes/+layout.server.ts"]?.tier).toBe(
      "owned",
    );

    const plan = planUpdate(project, REPO_TEMPLATES);
    expect(plan.changes.find((change) => change.path === usersLoader)?.action).toBe("update");
    expect(
      plan.changes.find((change) => change.path === "apps/web/src/routes/+layout.server.ts")
        ?.action,
    ).toBe("skip");

    const result = applyUpdate(project, REPO_TEMPLATES, { oldTemplatesDir: oldTemplates });
    expect(result.conflicts).toEqual([]);
    expect(result.written).toContain(usersLoader);
    expect(readFileSync(join(project, usersLoader), "utf8")).toContain(
      "requireAdmin(locals.user, locals);",
    );
    for (const path of ADMIN_DASHBOARD_MANAGED_ROUTE_LOADERS) {
      expect(readFilesLock(project)?.files[path]?.tier).toBe("managed");
    }
    expect(readFilesLock(project)?.files["apps/web/src/routes/+layout.server.ts"]?.tier).toBe(
      "owned",
    );
    const manifest = JSON.parse(readFileSync(join(project, ".podokit/manifest.json"), "utf8")) as {
      managedOverrides?: string[];
    };
    expect(manifest.managedOverrides).toEqual(
      expect.arrayContaining(ADMIN_DASHBOARD_MANAGED_ROUTE_LOADERS),
    );
  });

  it("three-way merges an edited route loader when a module starts managing it", () => {
    const oldTemplates = oldTemplatesCopy();
    const oldManifestPath = join(oldTemplates, "modules/admin-dashboard/module.manifest.json");
    const oldManifest = JSON.parse(readFileSync(oldManifestPath, "utf8")) as {
      managedOverrides?: string[];
    };
    delete oldManifest.managedOverrides;
    writeFileSync(oldManifestPath, `${JSON.stringify(oldManifest, null, 2)}\n`);

    const usersLoader = "apps/web/src/routes/(app)/admin/users/+page.server.ts";
    const oldUsersLoaderPath = join(oldTemplates, "modules/admin-dashboard/files", usersLoader);
    writeFileSync(
      oldUsersLoaderPath,
      readFileSync(oldUsersLoaderPath, "utf8").replace(
        "requireAdmin(locals.user, locals);",
        "requireAdmin(locals.user);",
      ),
    );

    const project = join(tmp(), "app");
    create({
      name: "app",
      template: "fullstack-nest-svelte",
      templatesDir: oldTemplates,
      targetDir: project,
    });
    addModule({
      projectRoot: project,
      module: "admin-dashboard",
      modulesDir: join(oldTemplates, "modules"),
    });
    const projectLoaderPath = join(project, usersLoader);
    writeFileSync(
      projectLoaderPath,
      `${readFileSync(projectLoaderPath, "utf8")}\n// application-specific audit hook\n`,
    );

    const plan = planUpdate(project, REPO_TEMPLATES);
    expect(plan.changes.find((change) => change.path === usersLoader)?.action).toBe("conflict");

    const result = applyUpdate(project, REPO_TEMPLATES, { oldTemplatesDir: oldTemplates });
    const merged = readFileSync(projectLoaderPath, "utf8");
    expect(result.merged).toContain(usersLoader);
    expect(result.conflicts).toEqual([]);
    expect(merged).toContain("requireAdmin(locals.user, locals);");
    expect(merged).toContain("// application-specific audit hook");
    expect(readFilesLock(project)?.files[usersLoader]?.tier).toBe("managed");
  });

  it("applies a clean update to an unedited managed file", () => {
    const oldTemplates = oldTemplatesCopy();
    const dir = join(tmp(), "app");
    // generate from the OLD templates
    create({ name: "app", template: "fullstack-nest-svelte", templatesDir: oldTemplates, targetDir: dir });
    // NEW templates change a managed file
    const tplMain = join(REPO_TEMPLATES, "fullstack-nest-svelte/apps/api/src/main.ts");
    const original = readFileSync(tplMain, "utf8");
    try {
      writeFileSync(tplMain, original + "\n// new in this version\n");
      const result = applyUpdate(dir, REPO_TEMPLATES, { oldTemplatesDir: oldTemplates });
      expect(result.written).toContain("apps/api/src/main.ts");
      expect(readFileSync(join(dir, "apps/api/src/main.ts"), "utf8")).toContain("// new in this version");
      expect(result.conflicts).toEqual([]);
    } finally {
      writeFileSync(tplMain, original);
    }
  });

  it("3-way merges a user edit with an upstream change without losing either", () => {
    const oldTemplates = oldTemplatesCopy();
    const dir = join(tmp(), "app");
    create({ name: "app", template: "fullstack-nest-svelte", templatesDir: oldTemplates, targetDir: dir });
    // user edits the FIRST line region; upstream edits the END — disjoint => clean 3-way
    const appMain = join(dir, "apps/api/src/main.ts");
    writeFileSync(appMain, "// my header\n" + readFileSync(appMain, "utf8"));
    const tplMain = join(REPO_TEMPLATES, "fullstack-nest-svelte/apps/api/src/main.ts");
    const original = readFileSync(tplMain, "utf8");
    try {
      writeFileSync(tplMain, original + "\n// upstream footer\n");
      const result = applyUpdate(dir, REPO_TEMPLATES, { oldTemplatesDir: oldTemplates });
      const merged = readFileSync(appMain, "utf8");
      expect(merged).toContain("// my header"); // user edit preserved
      expect(merged).toContain("// upstream footer"); // upstream change applied
      expect(result.conflicts).toEqual([]);

      // The lock keeps PodoKit's assembled output as the baseline. A repeated
      // update must still recognise the merged user header as an edit instead
      // of replacing the whole file with the template.
      const repeated = planUpdate(dir, REPO_TEMPLATES);
      expect(repeated.changes.find((change) => change.path === "apps/api/src/main.ts")?.action).toBe("conflict");
      const withoutBase = applyUpdate(dir, REPO_TEMPLATES);
      expect(withoutBase.conflicts).toContain("apps/api/src/main.ts");
      expect(readFileSync(appMain, "utf8")).toBe(merged);
    } finally {
      writeFileSync(tplMain, original);
    }
  });

  it("does not adopt unrelated application files as managed during update", () => {
    const oldTemplates = oldTemplatesCopy();
    const dir = join(tmp(), "app");
    create({ name: "app", template: "fullstack-nest-svelte", templatesDir: oldTemplates, targetDir: dir });
    const custom = join(dir, "apps/api/src/customer-domain.ts");
    writeFileSync(custom, "export const customerDomain = true;\n");

    applyUpdate(dir, REPO_TEMPLATES, { oldTemplatesDir: oldTemplates });

    expect(existsSync(custom)).toBe(true);
    expect(readFilesLock(dir)?.files["apps/api/src/customer-domain.ts"]).toBeUndefined();
    expect(planUpdate(dir, REPO_TEMPLATES).changes.some((change) => change.path === "apps/api/src/customer-domain.ts")).toBe(false);
  });

  it("leaves an edited file untouched and reports a conflict when no old version is given", () => {
    const dir = join(tmp(), "app");
    create({ name: "app", template: "fullstack-nest-svelte", templatesDir: REPO_TEMPLATES, targetDir: dir });
    const appMain = join(dir, "apps/api/src/main.ts");
    const edited = readFileSync(appMain, "utf8") + "\n// precious edit\n";
    writeFileSync(appMain, edited);
    const tplMain = join(REPO_TEMPLATES, "fullstack-nest-svelte/apps/api/src/main.ts");
    const original = readFileSync(tplMain, "utf8");
    try {
      writeFileSync(tplMain, original + "\n// upstream\n");
      const result = applyUpdate(dir, REPO_TEMPLATES); // no oldTemplatesDir
      expect(result.conflicts).toContain("apps/api/src/main.ts");
      expect(readFileSync(appMain, "utf8")).toBe(edited); // untouched
    } finally {
      writeFileSync(tplMain, original);
    }
    expect(existsSync(appMain)).toBe(true);
  });
});
