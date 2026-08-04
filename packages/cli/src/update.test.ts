import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  cpSync,
  mkdirSync,
  renameSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { create } from "./create";
import { addModule } from "./add";
import { assembleProject } from "./assemble";
import { eject } from "./eject";
import { planUpdate, applyUpdate, summarize } from "./update";
import { readFilesLock } from "./lockfile";

const REPO_TEMPLATES = resolve(process.cwd(), "..", "..", "templates");
const ADMIN_DASHBOARD_MANAGED_ROUTE_LOADERS = [
  "apps/web/src/routes/(app)/+layout.server.ts",
  "apps/web/src/routes/(admin)/+layout.server.ts",
  "apps/web/src/routes/(admin)/admin/account/+page.server.ts",
  "apps/web/src/routes/(admin)/admin/audit/+page.server.ts",
  "apps/web/src/routes/(admin)/admin/organizations/+page.server.ts",
  "apps/web/src/routes/(admin)/admin/sessions/+page.server.ts",
  "apps/web/src/routes/(admin)/admin/settings/+page.server.ts",
  "apps/web/src/routes/(admin)/admin/users/+page.server.ts",
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

  it("does not restore an explicitly ejected route loader after it is relocated", () => {
    const dir = join(tmp(), "app");
    create({
      name: "app",
      template: "fullstack-nest-svelte",
      templatesDir: REPO_TEMPLATES,
      targetDir: dir,
    });
    addModule({
      projectRoot: dir,
      module: "admin-dashboard",
      modulesDir: join(REPO_TEMPLATES, "modules"),
    });

    const originalLoader = "apps/web/src/routes/account/+page.server.ts";
    const originalPage = "apps/web/src/routes/account/+page.svelte";
    const relocatedDir = "apps/web/src/routes/(shell)/account";
    const relocatedLoader = `${relocatedDir}/+page.server.ts`;
    const relocatedPage = `${relocatedDir}/+page.svelte`;
    expect(eject(dir, [originalLoader]).ejected).toEqual([originalLoader]);
    mkdirSync(join(dir, relocatedDir), { recursive: true });
    renameSync(join(dir, originalLoader), join(dir, relocatedLoader));
    renameSync(join(dir, originalPage), join(dir, relocatedPage));

    const plan = planUpdate(dir, REPO_TEMPLATES);
    expect(plan.changes.find((change) => change.path === originalLoader)).toMatchObject({
      action: "skip",
      tier: "owned",
      note: "explicitly owned — missing or relocated; not restored",
    });

    const result = applyUpdate(dir, REPO_TEMPLATES);
    expect(result.written).not.toContain(originalLoader);
    expect(existsSync(join(dir, originalLoader))).toBe(false);
    expect(existsSync(join(dir, relocatedLoader))).toBe(true);
    expect(existsSync(join(dir, relocatedPage))).toBe(true);
    expect(planUpdate(dir, REPO_TEMPLATES).changes.find(
      (change) => change.path === originalLoader,
    )?.action).toBe("skip");
  });

  it("adopts an optional Playwright project extension as owned", () => {
    const dir = join(tmp(), "app");
    create({
      name: "app",
      template: "fullstack-nest-svelte",
      templatesDir: REPO_TEMPLATES,
      targetDir: dir,
    });
    const extension = "tests/playwright.projects.cjs";
    const content = 'module.exports = [{ name: "mobile" }];\n';
    writeFileSync(join(dir, extension), content);

    const result = applyUpdate(dir, REPO_TEMPLATES);
    expect(result.written).not.toContain(extension);
    expect(readFileSync(join(dir, extension), "utf8")).toBe(content);
    expect(readFilesLock(dir)?.files[extension]?.tier).toBe("owned");
    expect(planUpdate(dir, REPO_TEMPLATES).changes.find(
      (change) => change.path === extension,
    )?.action).toBe("skip");
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

  function legacyAdminTemplatesCopy(): string {
    const templates = oldTemplatesCopy();
    const moduleRoot = join(templates, "modules/admin-dashboard");
    const filesRoot = join(moduleRoot, "files");
    const routesRoot = join(filesRoot, "apps/web/src/routes");
    const componentsRoot = join(filesRoot, "apps/web/src/lib/components");

    mkdirSync(join(routesRoot, "(app)"), { recursive: true });
    renameSync(join(routesRoot, "(admin)/+layout.svelte"), join(routesRoot, "(app)/+layout.svelte"));
    renameSync(join(routesRoot, "(admin)/admin"), join(routesRoot, "(app)/admin"));
    rmSync(join(routesRoot, "(admin)/+layout.server.ts"));
    rmSync(join(routesRoot, "(admin)"), { recursive: true });
    renameSync(
      join(componentsRoot, "admin-sidebar.svelte"),
      join(componentsRoot, "app-sidebar.svelte"),
    );

    const legacyLayoutPath = join(routesRoot, "(app)/+layout.svelte");
    writeFileSync(
      legacyLayoutPath,
      readFileSync(legacyLayoutPath, "utf8")
        .replaceAll("AdminSidebar", "AppSidebar")
        .replace("admin-sidebar.svelte", "app-sidebar.svelte"),
    );

    const manifestPath = join(moduleRoot, "module.manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      manifestVersion?: number;
      managedOverrides: string[];
      migrations?: unknown[];
    };
    manifest.manifestVersion = 1;
    delete manifest.migrations;
    manifest.managedOverrides = manifest.managedOverrides
      .filter((path) => path !== "apps/web/src/routes/(admin)/+layout.server.ts")
      .map((path) => path.replace("routes/(admin)/admin/", "routes/(app)/admin/"));
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return templates;
  }

  it("adds newly introduced owned template and module seeds once", () => {
    const oldTemplates = oldTemplatesCopy();
    const extension = "apps/api/src/app.extensions.ts";
    const settingsComponent =
      "apps/web/src/routes/(admin)/admin/settings/general-settings.svelte";
    rmSync(join(oldTemplates, "fullstack-nest-svelte", extension));
    rmSync(join(oldTemplates, "modules/admin-dashboard/files", settingsComponent));

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

    expect(existsSync(join(project, extension))).toBe(false);
    expect(existsSync(join(project, settingsComponent))).toBe(false);
    const plan = planUpdate(project, REPO_TEMPLATES);
    expect(plan.changes.find((change) => change.path === extension)).toMatchObject({
      action: "add",
      tier: "owned",
    });
    expect(plan.changes.find((change) => change.path === settingsComponent)).toMatchObject({
      action: "add",
      tier: "owned",
    });

    const result = applyUpdate(project, REPO_TEMPLATES);
    expect(result.written).toEqual(expect.arrayContaining([extension, settingsComponent]));
    expect(readFilesLock(project)?.files[extension]?.tier).toBe("owned");
    expect(readFilesLock(project)?.files[settingsComponent]?.tier).toBe("owned");

    writeFileSync(join(project, extension), "// application extension\n");
    rmSync(join(project, settingsComponent));
    const repeat = planUpdate(project, REPO_TEMPLATES);
    expect(repeat.changes.find((change) => change.path === extension)?.action).toBe("skip");
    expect(repeat.changes.find((change) => change.path === settingsComponent)?.action).toBe(
      "skip",
    );
  });

  function legacyAdminProject(): string {
    const templates = legacyAdminTemplatesCopy();
    const project = join(tmp(), "legacy-admin-app");
    create({
      name: "legacy-admin-app",
      template: "fullstack-nest-svelte",
      templatesDir: templates,
      targetDir: project,
    });
    addModule({
      projectRoot: project,
      module: "admin-dashboard",
      modulesDir: join(templates, "modules"),
    });
    return project;
  }

  it("moves the admin shell while preserving the product route group", () => {
    const project = legacyAdminProject();
    const oldAdminRoot = join(project, "apps/web/src/routes/(app)/admin");
    const oldLayout = join(project, "apps/web/src/routes/(app)/+layout.svelte");
    mkdirSync(join(oldAdminRoot, "reports"), { recursive: true });
    writeFileSync(join(oldAdminRoot, "reports/+page.svelte"), "<h1>Custom admin report</h1>\n");
    mkdirSync(join(project, "apps/web/src/routes/(app)/dashboard"), { recursive: true });
    writeFileSync(
      join(project, "apps/web/src/routes/(app)/dashboard/+page.svelte"),
      "<h1>Product dashboard</h1>\n",
    );
    writeFileSync(oldLayout, `${readFileSync(oldLayout, "utf8")}\n<!-- local shell edit -->\n`);

    const plan = planUpdate(project, REPO_TEMPLATES);
    expect(
      plan.changes.find(
        (change) =>
          change.fromPath === "apps/web/src/routes/(app)/admin/reports/+page.svelte",
      ),
    ).toMatchObject({
      action: "move",
      path: "apps/web/src/routes/(admin)/admin/reports/+page.svelte",
    });
    expect(
      plan.changes.some(
        (change) => change.fromPath === "apps/web/src/routes/(app)/dashboard/+page.svelte",
      ),
    ).toBe(false);

    const result = applyUpdate(project, REPO_TEMPLATES);
    expect(result.conflicts).toEqual([]);
    expect(result.moved).toContainEqual({
      from: "apps/web/src/routes/(app)/admin/reports/+page.svelte",
      to: "apps/web/src/routes/(admin)/admin/reports/+page.svelte",
    });
    expect(existsSync(join(project, "apps/web/src/routes/(app)/+layout.server.ts"))).toBe(true);
    expect(existsSync(join(project, "apps/web/src/routes/(app)/+layout.svelte"))).toBe(false);
    expect(existsSync(join(project, "apps/web/src/routes/(app)/accept-invitation"))).toBe(true);
    expect(existsSync(join(project, "apps/web/src/routes/(app)/dashboard/+page.svelte"))).toBe(true);
    expect(
      readFileSync(join(project, "apps/web/src/routes/(admin)/+layout.svelte"), "utf8"),
    ).toContain("local shell edit");
    expect(
      readFileSync(join(project, "apps/web/src/routes/(admin)/+layout.svelte"), "utf8"),
    ).toContain('AdminSidebar from "$lib/components/admin-sidebar.svelte"');
    expect(
      readFileSync(
        join(project, "apps/web/src/routes/(admin)/admin/reports/+page.svelte"),
        "utf8",
      ),
    ).toContain("Custom admin report");
    expect(existsSync(join(project, "apps/web/src/lib/components/admin-sidebar.svelte"))).toBe(
      true,
    );
    expect(existsSync(join(project, "apps/web/src/lib/components/app-sidebar.svelte"))).toBe(
      false,
    );

    const manifest = JSON.parse(
      readFileSync(join(project, ".podokit/manifest.json"), "utf8"),
    ) as {
      schemaVersion: number;
      modules: { name: string; appliedMigrations?: string[] }[];
      managedOverrides: string[];
    };
    expect(manifest.schemaVersion).toBe(2);
    expect(readFilesLock(project)?.schemaVersion).toBe(2);
    expect(
      manifest.modules.find((module) => module.name === "admin-dashboard")
        ?.appliedMigrations,
    ).toContain("admin-route-group");
    expect(manifest.managedOverrides).toContain(
      "apps/web/src/routes/(admin)/admin/users/+page.server.ts",
    );
    expect(manifest.managedOverrides).not.toContain(
      "apps/web/src/routes/(app)/admin/users/+page.server.ts",
    );
    expect(summarize(planUpdate(project, REPO_TEMPLATES)).move).toBe(0);
  });

  it("aborts the admin route migration when a destination exists", () => {
    const project = legacyAdminProject();
    const collision = join(project, "apps/web/src/routes/(admin)/admin/users/+page.svelte");
    mkdirSync(join(collision, ".."), { recursive: true });
    writeFileSync(collision, "<h1>Existing destination</h1>\n");

    const plan = planUpdate(project, REPO_TEMPLATES);
    expect(plan.changes.some((change) => change.action === "conflict")).toBe(true);
    expect(() => applyUpdate(project, REPO_TEMPLATES)).toThrow(
      /destination already exists/,
    );
    expect(
      existsSync(join(project, "apps/web/src/routes/(app)/admin/users/+page.svelte")),
    ).toBe(true);
    expect(readFileSync(collision, "utf8")).toContain("Existing destination");
  });

  it("requires external modules to adopt a migrated route prefix first", () => {
    const project = legacyAdminProject();
    const packageRoot = join(
      project,
      "node_modules/@podosoft/podokit-module-legacy-admin",
    );
    const oldExtension = "apps/web/src/routes/(app)/admin/extension/+page.svelte";
    mkdirSync(join(packageRoot, "files", oldExtension, ".."), { recursive: true });
    writeFileSync(
      join(packageRoot, "package.json"),
      JSON.stringify({
        name: "@podosoft/podokit-module-legacy-admin",
        version: "0.1.0",
      }),
    );
    writeFileSync(
      join(packageRoot, "module.manifest.json"),
      JSON.stringify({
        manifestVersion: 1,
        name: "legacy-admin",
        description: "Legacy admin extension",
        targetApp: "web",
      }),
    );
    writeFileSync(join(packageRoot, "files", oldExtension), "<h1>Extension</h1>\n");
    addModule({
      projectRoot: project,
      module: "@podosoft/podokit-module-legacy-admin",
      modulesDir: join(REPO_TEMPLATES, "modules"),
    });

    const blocked = planUpdate(project, REPO_TEMPLATES);
    expect(
      blocked.changes.find(
        (change) =>
          change.action === "conflict" &&
          change.note.includes("upgrade external modules before updating"),
      ),
    ).toBeDefined();
    expect(() => applyUpdate(project, REPO_TEMPLATES)).toThrow(
      /upgrade external modules before updating/,
    );
    expect(existsSync(join(project, oldExtension))).toBe(true);

    const newExtension = oldExtension.replace(
      "routes/(app)/admin/",
      "routes/(admin)/admin/",
    );
    mkdirSync(join(packageRoot, "files", newExtension, ".."), { recursive: true });
    renameSync(
      join(packageRoot, "files", oldExtension),
      join(packageRoot, "files", newExtension),
    );
    rmSync(join(packageRoot, "files/apps/web/src/routes/(app)"), {
      recursive: true,
    });

    const result = applyUpdate(project, REPO_TEMPLATES);
    expect(result.moved).toContainEqual({
      from: oldExtension,
      to: newExtension,
    });
    expect(existsSync(join(project, newExtension))).toBe(true);
    expect(existsSync(join(project, oldExtension))).toBe(false);
  });

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

  it("adds module requirements introduced by target templates", () => {
    const oldTemplates = oldTemplatesCopy();
    const newTemplates = oldTemplatesCopy();
    const featureFile = "apps/api/src/update-feature.ts";
    const dependencyFile = "apps/api/src/update-dependency.ts";

    for (const templates of [oldTemplates, newTemplates]) {
      const featureRoot = join(templates, "modules/update-feature");
      const dependencyRoot = join(templates, "modules/update-dependency");
      mkdirSync(join(featureRoot, "files/apps/api/src"), { recursive: true });
      mkdirSync(join(dependencyRoot, "files/apps/api/src"), { recursive: true });
      writeFileSync(
        join(featureRoot, "module.manifest.json"),
        `${JSON.stringify({
          name: "update-feature",
          description: "Update feature",
          targetApp: "api",
        }, null, 2)}\n`,
      );
      writeFileSync(
        join(dependencyRoot, "module.manifest.json"),
        `${JSON.stringify({
          name: "update-dependency",
          description: "Update dependency",
          targetApp: "api",
        }, null, 2)}\n`,
      );
      writeFileSync(
        join(featureRoot, "files", featureFile),
        'export { updateDependency } from "./update-dependency";\n',
      );
      writeFileSync(
        join(dependencyRoot, "files", dependencyFile),
        "export const updateDependency = true;\n",
      );
    }

    const targetManifestPath = join(
      newTemplates,
      "modules/update-feature/module.manifest.json",
    );
    const targetManifest = JSON.parse(
      readFileSync(targetManifestPath, "utf8"),
    ) as Record<string, unknown>;
    targetManifest.requires = ["update-dependency"];
    writeFileSync(targetManifestPath, `${JSON.stringify(targetManifest, null, 2)}\n`);

    const project = join(tmp(), "app");
    create({
      name: "app",
      template: "fullstack-nest-svelte",
      templatesDir: oldTemplates,
      targetDir: project,
    });
    addModule({
      projectRoot: project,
      module: "update-feature",
      modulesDir: join(oldTemplates, "modules"),
    });
    expect(existsSync(join(project, dependencyFile))).toBe(false);

    const plan = planUpdate(project, newTemplates);
    expect(plan.modules).toEqual(["update-dependency", "update-feature"]);
    expect(plan.changes.find((change) => change.path === dependencyFile)?.action).toBe(
      "add",
    );

    const result = applyUpdate(project, newTemplates, {
      oldTemplatesDir: oldTemplates,
    });
    expect(result.written).toContain(dependencyFile);
    expect(readFileSync(join(project, featureFile), "utf8")).toContain(
      "update-dependency",
    );
    const manifest = JSON.parse(
      readFileSync(join(project, ".podokit/manifest.json"), "utf8"),
    ) as {
      modules: { name: string; order: number }[];
    };
    expect(manifest.modules.map((module) => module.name)).toEqual([
      "update-dependency",
      "update-feature",
    ]);
    expect(manifest.modules.map((module) => module.order)).toEqual([0, 1]);
    expect(
      planUpdate(project, newTemplates).changes.find(
        (change) => change.path === dependencyFile,
      )?.action,
    ).toBe("up-to-date");
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
      "modules/admin-dashboard/files/apps/web/src/routes/(admin)/admin/users/+page.server.ts",
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

    const usersLoader = "apps/web/src/routes/(admin)/admin/users/+page.server.ts";
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

    const usersLoader = "apps/web/src/routes/(admin)/admin/users/+page.server.ts";
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
