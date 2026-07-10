import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  copyTemplate,
  insertAtMarker,
  mergePackageJson,
  type JsonObject,
  type TemplateVars,
} from "@podosoft/podokit-template-engine";
import { recordModules } from "./lockfile";

interface Injection {
  file: string;
  marker: string;
  text: string;
  /** Skip (instead of failing) if the target file or marker is absent. */
  optional?: boolean;
}

export interface ModuleManifest {
  name: string;
  description: string;
  requires?: string[];
  targetApp: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  env?: string[];
  inject?: Injection[];
  instructions?: string[];
}

export interface AddOptions {
  projectRoot: string;
  module: string;
  modulesDir: string;
  /** PodoKit version stamped into the lockfile. Defaults to the CLI version. */
  podokitVersion?: string;
}

export interface AddResult {
  module: string;
  instructions: string[];
  /** Required modules that were auto-added because they were missing. */
  added: string[];
}

/** List modules available under `modulesDir` (each has a module.manifest.json). */
export function listModules(modulesDir: string): { name: string; description: string }[] {
  if (!existsSync(modulesDir)) return [];
  return readdirSync(modulesDir)
    .filter((name) => existsSync(join(modulesDir, name, "module.manifest.json")))
    .map((name) => {
      const manifest = readManifest(join(modulesDir, name));
      return { name, description: manifest.description };
    });
}

function readManifest(moduleDir: string): ModuleManifest {
  return JSON.parse(readFileSync(join(moduleDir, "module.manifest.json"), "utf8")) as ModuleManifest;
}

function readJson(path: string): JsonObject {
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}

function projectName(projectRoot: string): string {
  const pkg = readJson(join(projectRoot, "package.json"));
  return typeof pkg.name === "string" ? pkg.name : "app";
}

function appendEnv(projectRoot: string, lines: string[]): void {
  const file = join(projectRoot, ".env.example");
  if (!existsSync(file)) return;
  const current = readFileSync(file, "utf8");
  const missing = lines.filter((line) => !current.split("\n").includes(line));
  if (missing.length === 0) return;
  const separator = current.endsWith("\n") ? "" : "\n";
  writeFileSync(file, `${current}${separator}\n${missing.join("\n")}\n`);
}

/** Heuristic: is `module` already applied to the project? */
function isApplied(projectRoot: string, modulesDir: string, module: string): boolean {
  const manifestPath = join(modulesDir, module, "module.manifest.json");
  if (!existsSync(manifestPath)) return false;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ModuleManifest;
  const firstInject = manifest.inject?.[0];
  if (firstInject) {
    const target = join(projectRoot, firstInject.file);
    return existsSync(target) && readFileSync(target, "utf8").includes(firstInject.text);
  }
  return false;
}

/**
 * Apply a module to an existing generated project: overlay files, merge the
 * target app's package.json dependencies and scripts, append env example lines,
 * and inject wiring at markers. Missing required modules are added first.
 */
export function addModule(options: AddOptions): AddResult {
  const result = applyModule(options.projectRoot, options.module, options.modulesDir, new Set());
  // Record the module (and any auto-added requirements) and refresh the lock.
  recordModules(options.projectRoot, [...result.added, result.module], options.podokitVersion);
  return result;
}

function applyModule(
  projectRoot: string,
  module: string,
  modulesDir: string,
  applied: Set<string>,
): AddResult {
  const moduleDir = join(modulesDir, module);
  if (!existsSync(join(moduleDir, "module.manifest.json"))) {
    const available = listModules(modulesDir).map((m) => m.name);
    throw new Error(
      `Unknown module "${module}".${available.length ? ` Available: ${available.join(", ")}.` : ""}`,
    );
  }
  const manifest = readManifest(moduleDir);

  const appPkgPath = join(projectRoot, "apps", manifest.targetApp, "package.json");
  if (!existsSync(appPkgPath)) {
    throw new Error(
      `This does not look like a PodoKit project: ${join("apps", manifest.targetApp, "package.json")} not found. Run inside a generated project.`,
    );
  }

  applied.add(module);

  // 0) apply required modules first (auto-add if missing)
  const added: string[] = [];
  for (const required of manifest.requires ?? []) {
    if (applied.has(required) || isApplied(projectRoot, modulesDir, required)) continue;
    const result = applyModule(projectRoot, required, modulesDir, applied);
    added.push(required, ...result.added);
  }

  const appName = projectName(projectRoot);
  const vars: TemplateVars = { projectName: appName };

  // 1) overlay files
  const filesDir = join(moduleDir, "files");
  if (existsSync(filesDir)) {
    copyTemplate(filesDir, projectRoot, vars);
  }

  // 2) merge dependencies and scripts into the target app
  if (manifest.dependencies || manifest.devDependencies || manifest.scripts) {
    const overlay: JsonObject = {};
    if (manifest.dependencies) overlay.dependencies = manifest.dependencies;
    if (manifest.devDependencies) overlay.devDependencies = manifest.devDependencies;
    if (manifest.scripts) overlay.scripts = manifest.scripts;
    const merged = mergePackageJson(readJson(appPkgPath), overlay);
    writeFileSync(appPkgPath, `${JSON.stringify(merged, null, 2)}\n`);
  }

  // 3) append env example lines
  if (manifest.env?.length) {
    appendEnv(projectRoot, manifest.env);
  }

  // 4) inject wiring at markers
  for (const injection of manifest.inject ?? []) {
    const target = join(projectRoot, injection.file);
    if (!existsSync(target)) {
      if (injection.optional) continue;
      throw new Error(`Cannot wire module: ${injection.file} not found.`);
    }
    const content = readFileSync(target, "utf8");
    if (injection.optional && !content.includes(injection.marker)) continue;
    writeFileSync(target, insertAtMarker(content, injection.marker, injection.text));
  }

  const instructions = (manifest.instructions ?? []).map((line) => line.replace(/<app>/g, appName));
  return { module, instructions, added };
}
