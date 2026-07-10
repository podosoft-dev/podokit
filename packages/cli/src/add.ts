import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
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

/** Highest `module.manifest.json` schema version this CLI understands. A package
 *  module declaring a higher version is rejected rather than mis-applied. */
export const SUPPORTED_MANIFEST_VERSION = 1;

export interface ModuleManifest {
  /** Manifest schema version. Absent (bundled modules) means "same as the CLI". */
  manifestVersion?: number;
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
  /** App-relative globs this module's files should own (durably user-editable,
   *  never touched by `podo update`). Merged into the project's ownedGlobs so
   *  they survive lock recompute. Use for public presentation pages a consumer
   *  restyles, while keeping the module's `$lib` logic managed. */
  ownedGlobs?: string[];
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
  /** ownedGlobs declared by this module and every module it pulled in. */
  ownedGlobs: string[];
}

const PACKAGE_PREFIX = "@podosoft/podokit-module-";

/**
 * Resolve a module's directory by name: first the bundled `modulesDir`, then a
 * node-resolvable npm package `@podosoft/podokit-module-<name>` installed in the
 * project (or a fully-qualified `@scope/pkg` name). Returns null if not found.
 */
export function resolveModuleDir(name: string, modulesDir: string, projectRoot: string): string | null {
  const bundled = join(modulesDir, name);
  if (existsSync(join(bundled, "module.manifest.json"))) return bundled;
  const pkg = name.includes("/") ? name : `${PACKAGE_PREFIX}${name}`;
  try {
    const req = createRequire(join(projectRoot, "package.json"));
    return dirname(req.resolve(`${pkg}/module.manifest.json`));
  } catch {
    return null;
  }
}

function assertManifestVersion(name: string, manifest: ModuleManifest): void {
  if ((manifest.manifestVersion ?? SUPPORTED_MANIFEST_VERSION) > SUPPORTED_MANIFEST_VERSION) {
    throw new Error(
      `Module "${name}" needs a newer PodoKit (manifest v${manifest.manifestVersion}, this CLI supports v${SUPPORTED_MANIFEST_VERSION}). Update @podosoft/podokit.`,
    );
  }
}

/** List modules available to a project: the bundled ones under `modulesDir` plus,
 *  when `projectRoot` is given, any `@podosoft/podokit-module-*` packages installed
 *  in it. Bundled names take precedence on a clash. */
export function listModules(
  modulesDir: string,
  projectRoot?: string,
): { name: string; description: string }[] {
  const out = new Map<string, string>();
  if (existsSync(modulesDir)) {
    for (const name of readdirSync(modulesDir)) {
      if (existsSync(join(modulesDir, name, "module.manifest.json"))) {
        out.set(name, readManifest(join(modulesDir, name)).description);
      }
    }
  }
  if (projectRoot) {
    const scope = join(projectRoot, "node_modules", "@podosoft");
    if (existsSync(scope)) {
      for (const dir of readdirSync(scope)) {
        if (!dir.startsWith("podokit-module-")) continue;
        const manifestPath = join(scope, dir, "module.manifest.json");
        if (!existsSync(manifestPath)) continue;
        const manifest = readManifest(join(scope, dir));
        if (!out.has(manifest.name)) out.set(manifest.name, manifest.description);
      }
    }
  }
  return [...out].map(([name, description]) => ({ name, description }));
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
  const moduleDir = resolveModuleDir(module, modulesDir, projectRoot);
  if (!moduleDir) return false;
  const manifest = readManifest(moduleDir);
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
  // Record the module (and any auto-added requirements), fold in the modules'
  // declared ownedGlobs, and refresh the lock.
  recordModules(
    options.projectRoot,
    [...result.added, result.module],
    options.podokitVersion,
    result.ownedGlobs,
  );
  return result;
}

function applyModule(
  projectRoot: string,
  module: string,
  modulesDir: string,
  applied: Set<string>,
): AddResult {
  const moduleDir = resolveModuleDir(module, modulesDir, projectRoot);
  if (!moduleDir) {
    const available = listModules(modulesDir, projectRoot).map((m) => m.name);
    throw new Error(
      `Unknown module "${module}".${available.length ? ` Available: ${available.join(", ")}.` : ""}`,
    );
  }
  const manifest = readManifest(moduleDir);
  assertManifestVersion(module, manifest);

  const appPkgPath = join(projectRoot, "apps", manifest.targetApp, "package.json");
  if (!existsSync(appPkgPath)) {
    throw new Error(
      `This does not look like a PodoKit project: ${join("apps", manifest.targetApp, "package.json")} not found. Run inside a generated project.`,
    );
  }

  applied.add(module);

  // 0) apply required modules first (auto-add if missing)
  const added: string[] = [];
  const ownedGlobs: string[] = [...(manifest.ownedGlobs ?? [])];
  for (const required of manifest.requires ?? []) {
    if (applied.has(required) || isApplied(projectRoot, modulesDir, required)) continue;
    const result = applyModule(projectRoot, required, modulesDir, applied);
    added.push(required, ...result.added);
    ownedGlobs.push(...result.ownedGlobs);
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
  return { module, instructions, added, ownedGlobs };
}
