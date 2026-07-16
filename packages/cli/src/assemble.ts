import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  renderTemplate,
  insertAtMarker,
  mergePackageJson,
  type JsonObject,
  type TemplateVars,
  type VfsTree,
} from "@podosoft/podokit-template-engine";
import { modulePackageOverlays, resolveModule, type ModuleManifest } from "./add";
import type { ManifestModule } from "./lockfile";

/**
 * Reconstruct a generated project in memory (no disk writes) from a template
 * plus an ordered module list, mirroring `create` + `add`. `podo update` uses
 * this to build the new-version tree and diff it against the working copy.
 */
export interface AssembleOptions {
  templatesDir: string;
  template: string;
  answers: TemplateVars;
  modules: (string | ManifestModule)[];
  /** Generated project whose node_modules may contain external modules. */
  projectRoot?: string;
}

function readManifest(moduleDir: string): ModuleManifest {
  return JSON.parse(readFileSync(join(moduleDir, "module.manifest.json"), "utf8")) as ModuleManifest;
}

function textOf(tree: VfsTree, path: string): string {
  return String(tree.get(path)?.content ?? "");
}

function setText(tree: VfsTree, path: string, content: string): void {
  tree.set(path, { content, text: true });
}

function applyModuleToTree(tree: VfsTree, moduleDir: string, vars: TemplateVars): void {
  const manifest = readManifest(moduleDir);

  // 1) overlay files (module files override the base)
  const filesDir = join(moduleDir, "files");
  if (existsSync(filesDir)) {
    for (const [path, file] of renderTemplate(filesDir, vars)) tree.set(path, file);
  }

  // 2) merge dependencies/scripts into every declared app package.json
  for (const [app, declaration] of modulePackageOverlays(manifest)) {
    const pkgPath = `apps/${app}/package.json`;
    const base = JSON.parse(textOf(tree, pkgPath) || "{}") as JsonObject;
    const overlay: JsonObject = {};
    if (declaration.dependencies) overlay.dependencies = declaration.dependencies;
    if (declaration.devDependencies) overlay.devDependencies = declaration.devDependencies;
    if (declaration.scripts) overlay.scripts = declaration.scripts;
    setText(tree, pkgPath, `${JSON.stringify(mergePackageJson(base, overlay), null, 2)}\n`);
  }

  // 3) append env example lines (deduped)
  if (manifest.env?.length) {
    const current = textOf(tree, ".env.example");
    const existing = current.split("\n");
    const missing = manifest.env.filter((line) => !existing.includes(line));
    if (missing.length) {
      const sep = current.endsWith("\n") ? "" : "\n";
      setText(tree, ".env.example", `${current}${sep}\n${missing.join("\n")}\n`);
    }
  }

  // 4) inject wiring at markers
  for (const injection of manifest.inject ?? []) {
    const target = injection.file;
    const content = textOf(tree, target);
    if (injection.optional && !content.includes(injection.marker)) continue;
    setText(tree, target, insertAtMarker(content, injection.marker, injection.text));
  }
}

function preserveExternalPackageDependency(
  tree: VfsTree,
  projectRoot: string,
  packageName: string,
): void {
  const diskPackagePath = join(projectRoot, "package.json");
  if (!existsSync(diskPackagePath)) return;
  const diskPackage = JSON.parse(readFileSync(diskPackagePath, "utf8")) as Record<string, unknown>;
  const rootPackage = JSON.parse(textOf(tree, "package.json") || "{}") as Record<string, unknown>;
  for (const section of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
    const diskSection = diskPackage[section];
    if (!diskSection || typeof diskSection !== "object" || Array.isArray(diskSection)) continue;
    const version = (diskSection as Record<string, unknown>)[packageName];
    if (typeof version !== "string") continue;
    const current = rootPackage[section];
    const dependencies = current && typeof current === "object" && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {};
    dependencies[packageName] = version;
    rootPackage[section] = dependencies;
    setText(tree, "package.json", `${JSON.stringify(rootPackage, null, 2)}\n`);
    return;
  }
}

/** Assemble the project tree for a template + ordered modules, in memory. */
export function assembleProject(options: AssembleOptions): VfsTree {
  const tree = renderTemplate(join(options.templatesDir, options.template), options.answers);
  for (const mod of options.modules) {
    const name = typeof mod === "string" ? mod : (mod.packageName ?? mod.name);
    const resolved = resolveModule(
      name,
      join(options.templatesDir, "modules"),
      options.projectRoot ?? options.templatesDir,
    );
    if (!resolved) {
      const label = typeof mod === "string" ? mod : mod.name;
      throw new Error(
        `Cannot resolve module "${label}" while assembling the project. ` +
          "Install its package before running podo update.",
      );
    }
    applyModuleToTree(tree, resolved.dir, options.answers);
    if (typeof mod !== "string" && mod.packageName && options.projectRoot) {
      preserveExternalPackageDependency(tree, options.projectRoot, mod.packageName);
    }
  }
  return tree;
}
