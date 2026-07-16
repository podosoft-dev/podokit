import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import {
  hashContent,
  insertAtMarker,
  mergePackageJson,
  renderTemplate,
  type JsonObject,
  type TemplateVars,
} from "@podosoft/podokit-template-engine";
import {
  matchGlob,
  readFilesLock,
  readManifest as readProjectManifest,
  recordModules,
  writeManifest,
  type ManifestModuleInput,
} from "./lockfile";

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
  /** Extra package.json overlays keyed by app name. Use when a module's files
   *  span more than its primary targetApp. */
  packageOverlays?: Record<string, PackageOverlay>;
  env?: string[];
  inject?: Injection[];
  instructions?: string[];
  /** App-relative globs this module's files should own (durably user-editable,
   *  never touched by `podo update`). Merged into the project's ownedGlobs so
   *  they survive lock recompute. Use for public presentation pages a consumer
   *  restyles, while keeping the module's `$lib` logic managed. */
  ownedGlobs?: string[];
  /** Paths that an existing app may explicitly hand back to this module with
   *  `podo add --adopt`. Broad app-owned route globs are never removed. */
  managedGlobs?: string[];
  /** Module files that remain update-managed even when a broad default glob
   *  (for example `.claude/**`) would otherwise classify them as owned. */
  managedOverrides?: string[];
}

export interface PackageOverlay {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

/** Return the legacy targetApp package fields plus any additional app overlays. */
export function modulePackageOverlays(manifest: ModuleManifest): Map<string, PackageOverlay> {
  const overlays = new Map<string, PackageOverlay>();
  const merge = (app: string, overlay: PackageOverlay): void => {
    const current = overlays.get(app) ?? {};
    overlays.set(app, {
      ...(current.dependencies || overlay.dependencies
        ? { dependencies: { ...current.dependencies, ...overlay.dependencies } }
        : {}),
      ...(current.devDependencies || overlay.devDependencies
        ? { devDependencies: { ...current.devDependencies, ...overlay.devDependencies } }
        : {}),
      ...(current.scripts || overlay.scripts
        ? { scripts: { ...current.scripts, ...overlay.scripts } }
        : {}),
    });
  };

  if (manifest.dependencies || manifest.devDependencies || manifest.scripts) {
    merge(manifest.targetApp, {
      dependencies: manifest.dependencies,
      devDependencies: manifest.devDependencies,
      scripts: manifest.scripts,
    });
  }
  for (const [app, overlay] of Object.entries(manifest.packageOverlays ?? {})) merge(app, overlay);
  return overlays;
}

export interface AddOptions {
  projectRoot: string;
  module: string;
  modulesDir: string;
  /** PodoKit version stamped into the lockfile. Defaults to the CLI version. */
  podokitVersion?: string;
  /** Adopt colliding files covered by the module's managedGlobs. */
  adopt?: boolean;
}

export interface AddResult {
  module: string;
  instructions: string[];
  /** Required modules that were auto-added because they were missing. */
  added: string[];
  /** ownedGlobs declared by this module and every module it pulled in. */
  ownedGlobs: string[];
  /** Managed exceptions declared by this module and its requirements. */
  managedOverrides: string[];
  /** Existing owned presentation files intentionally left untouched. */
  preserved: string[];
  /** Paths explicitly adopted as module-managed files. */
  adopted: string[];
  /** Files shipped, merged, or injected while applying the module. */
  touched: string[];
}

export interface ResolvedModule {
  dir: string;
  name: string;
  packageName?: string;
  moduleVersion?: string;
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

/** Resolve a module and capture the package identity needed to replay external
 * modules during `podo update`. */
export function resolveModule(name: string, modulesDir: string, projectRoot: string): ResolvedModule | null {
  const dir = resolveModuleDir(name, modulesDir, projectRoot);
  if (!dir) return null;
  const manifest = readModuleManifest(dir);
  const bundled = join(modulesDir, manifest.name);
  if (dir === bundled) return { dir, name: manifest.name };
  const packageFile = join(dir, "package.json");
  if (!existsSync(packageFile)) return { dir, name: manifest.name };
  const pkg = readJson(packageFile);
  return {
    dir,
    name: manifest.name,
    packageName: typeof pkg.name === "string" ? pkg.name : undefined,
    moduleVersion: typeof pkg.version === "string" ? pkg.version : undefined,
  };
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
        out.set(name, readModuleManifest(join(modulesDir, name)).description);
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
        const manifest = readModuleManifest(join(scope, dir));
        if (!out.has(manifest.name)) out.set(manifest.name, manifest.description);
      }
    }
  }
  return [...out].map(([name, description]) => ({ name, description }));
}

export function readModuleManifest(moduleDir: string): ModuleManifest {
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
  const manifest = readModuleManifest(moduleDir);
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
  const previousLock = readFilesLock(options.projectRoot);
  const cleanPaths = previousLock
    ? Object.entries(previousLock.files)
        .filter(([path, entry]) => {
          const target = join(options.projectRoot, path);
          return existsSync(target) && hashContent(readFileSync(target)) === entry.outHash;
        })
        .map(([path]) => path)
    : [];
  const result = applyModule(
    options.projectRoot,
    options.module,
    options.modulesDir,
    new Set(),
    options.adopt ?? false,
  );
  if (options.adopt && result.adopted.length) {
    releaseOwnedPaths(options.projectRoot, result.adopted);
  }
  // Record the module (and any auto-added requirements), fold in the modules'
  // declared ownedGlobs, and refresh the lock.
  const records = [...result.added, result.module]
    .map((name) => resolveModule(name, options.modulesDir, options.projectRoot))
    .filter((module): module is ResolvedModule => module !== null)
    .map(moduleRecord);
  recordModules(
    options.projectRoot,
    records,
    options.podokitVersion,
    result.ownedGlobs,
    previousLock
      ? {
          previous: previousLock,
          cleanPaths,
          modulePaths: [...new Set(result.touched)],
          adoptedPaths: result.adopted,
        }
      : undefined,
    result.managedOverrides,
  );
  return result;
}

function applyModule(
  projectRoot: string,
  module: string,
  modulesDir: string,
  applied: Set<string>,
  adopt: boolean,
): AddResult {
  const resolved = resolveModule(module, modulesDir, projectRoot);
  if (!resolved) {
    const available = listModules(modulesDir, projectRoot).map((m) => m.name);
    throw new Error(
      `Unknown module "${module}".${available.length ? ` Available: ${available.join(", ")}.` : ""}`,
    );
  }
  const moduleDir = resolved.dir;
  const manifest = readModuleManifest(moduleDir);
  assertManifestVersion(module, manifest);

  const requiredApps = new Set([manifest.targetApp, ...Object.keys(manifest.packageOverlays ?? {})]);
  const missingApp = [...requiredApps].find(
    (app) => !existsSync(join(projectRoot, "apps", app, "package.json")),
  );
  if (missingApp) {
    throw new Error(
      `This does not look like a PodoKit project: ${join("apps", missingApp, "package.json")} not found. Run inside a generated project.`,
    );
  }

  applied.add(module);

  // 0) apply required modules first (auto-add if missing)
  const added: string[] = [];
  const ownedGlobs: string[] = [...(manifest.ownedGlobs ?? [])];
  const managedOverrides: string[] = [...(manifest.managedOverrides ?? [])];
  const preserved: string[] = [];
  const adopted: string[] = [];
  const touched: string[] = [];
  for (const required of manifest.requires ?? []) {
    if (applied.has(required) || isApplied(projectRoot, modulesDir, required)) continue;
    const result = applyModule(projectRoot, required, modulesDir, applied, adopt);
    added.push(required, ...result.added);
    ownedGlobs.push(...result.ownedGlobs);
    managedOverrides.push(...result.managedOverrides);
    preserved.push(...result.preserved);
    adopted.push(...result.adopted);
    touched.push(...result.touched);
  }

  const appName = projectName(projectRoot);
  const vars: TemplateVars = { projectName: appName };

  // 1) overlay files
  const filesDir = join(moduleDir, "files");
  if (existsSync(filesDir)) {
    const copied = copyModuleFiles({
      filesDir,
      projectRoot,
      vars,
      managedGlobs: manifest.managedGlobs ?? [],
      adopt,
    });
    preserved.push(...copied.preserved);
    adopted.push(...copied.adopted);
    touched.push(...copied.touched);
  }

  // 2) merge dependencies and scripts into every declared app package
  for (const [app, declaration] of modulePackageOverlays(manifest)) {
    const appPkgPath = join(projectRoot, "apps", app, "package.json");
    const overlay: JsonObject = {};
    if (declaration.dependencies) overlay.dependencies = declaration.dependencies;
    if (declaration.devDependencies) overlay.devDependencies = declaration.devDependencies;
    if (declaration.scripts) overlay.scripts = declaration.scripts;
    const merged = mergePackageJson(readJson(appPkgPath), overlay);
    writeFileSync(appPkgPath, `${JSON.stringify(merged, null, 2)}\n`);
    touched.push(`apps/${app}/package.json`);
  }

  // 3) append env example lines
  if (manifest.env?.length) {
    appendEnv(projectRoot, manifest.env);
    touched.push(".env.example");
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
    touched.push(injection.file);
  }

  const instructions = (manifest.instructions ?? []).map((line) => line.replace(/<app>/g, appName));
  return {
    module: manifest.name,
    instructions,
    added,
    ownedGlobs,
    managedOverrides,
    preserved,
    adopted,
    touched,
  };
}

function moduleRecord(module: ResolvedModule): ManifestModuleInput {
  return {
    name: module.name,
    packageName: module.packageName,
    moduleVersion: module.moduleVersion,
  };
}

interface CopyModuleFilesOptions {
  filesDir: string;
  projectRoot: string;
  vars: TemplateVars;
  managedGlobs: string[];
  adopt: boolean;
}

/** Copy a module overlay without clobbering app-owned presentation files. */
function copyModuleFiles(options: CopyModuleFilesOptions): { preserved: string[]; adopted: string[]; touched: string[] } {
  const tree = renderTemplate(options.filesDir, options.vars);
  const lock = readFilesLock(options.projectRoot);
  const preserved: string[] = [];
  const adopted: string[] = [];
  const touched: string[] = [];

  for (const [rel, file] of tree) {
    touched.push(rel);
    const target = join(options.projectRoot, rel);
    const existed = existsSync(target);
    const entry = lock?.files[rel];
    const canAdopt = options.managedGlobs.some((glob) => matchGlob(rel, glob));
    if (existed && entry?.tier === "owned" && !(options.adopt && canAdopt)) {
      preserved.push(rel);
      continue;
    }
    if (existed && !entry && !(options.adopt && canAdopt)) {
      const current = readFileSync(target);
      const next = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content);
      if (!current.equals(next)) {
        throw new Error(
          `Cannot add module: ${rel} already exists outside PodoKit ownership. ` +
            "Move it, or re-run with --adopt when the module declares the path managed.",
        );
      }
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
    if (existed && options.adopt && canAdopt) adopted.push(rel);
  }
  return { preserved, adopted, touched };
}

/** Remove only exact owned paths that an explicit adoption handed back. Broad
 * ownership rules such as `apps/web/src/routes/**` remain intact. */
function releaseOwnedPaths(projectRoot: string, adopted: string[]): void {
  const manifest = readProjectManifest(projectRoot);
  if (!manifest) return;
  const adoptedSet = new Set(adopted);
  manifest.ownedGlobs = manifest.ownedGlobs.filter(
    (glob) => glob.includes("*") || !adoptedSet.has(glob),
  );
  writeManifest(projectRoot, manifest);
}
