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
import type { ModuleManifest } from "./add";

/**
 * Reconstruct a generated project in memory (no disk writes) from a template
 * plus an ordered module list, mirroring `create` + `add`. `podo update` uses
 * this to build the new-version tree and diff it against the working copy.
 */
export interface AssembleOptions {
  templatesDir: string;
  template: string;
  answers: TemplateVars;
  modules: string[];
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

  // 2) merge dependencies/scripts into the target app's package.json
  if (manifest.dependencies || manifest.devDependencies || manifest.scripts) {
    const pkgPath = `apps/${manifest.targetApp}/package.json`;
    const base = JSON.parse(textOf(tree, pkgPath) || "{}") as JsonObject;
    const overlay: JsonObject = {};
    if (manifest.dependencies) overlay.dependencies = manifest.dependencies;
    if (manifest.devDependencies) overlay.devDependencies = manifest.devDependencies;
    if (manifest.scripts) overlay.scripts = manifest.scripts;
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

/** Assemble the project tree for a template + ordered modules, in memory. */
export function assembleProject(options: AssembleOptions): VfsTree {
  const tree = renderTemplate(join(options.templatesDir, options.template), options.answers);
  for (const mod of options.modules) {
    applyModuleToTree(tree, join(options.templatesDir, "modules", mod), options.answers);
  }
  return tree;
}
