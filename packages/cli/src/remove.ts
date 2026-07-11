import { existsSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  renderTemplate,
  removeAtMarker,
  hashContent,
  type JsonObject,
  type TemplateVars,
} from "@podosoft/podokit-template-engine";
import { resolveModuleDir, type ModuleManifest } from "./add";
import {
  computeFilesLock,
  readFilesLock,
  readManifest,
  writeFilesLock,
  writeManifest,
} from "./lockfile";

export interface RemoveOptions {
  projectRoot: string;
  module: string;
  modulesDir: string;
  /** PodoKit version stamped into the lockfile. Defaults to the CLI version. */
  podokitVersion?: string;
}

export interface RemoveResult {
  module: string;
  /** Module overlay files deleted from the project. */
  removed: string[];
  /** Module files kept because the user edited them (delete manually if desired). */
  keptEdited: string[];
  /** Module files kept because another installed module also ships them. */
  keptShared: string[];
  /** Injection targets whose wiring was removed. */
  unwired: string[];
}

function readModuleManifest(moduleDir: string): ModuleManifest {
  return JSON.parse(readFileSync(join(moduleDir, "module.manifest.json"), "utf8")) as ModuleManifest;
}

function readJson(path: string): JsonObject {
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}

function projectName(projectRoot: string): string {
  const pkg = readJson(join(projectRoot, "package.json"));
  return typeof pkg.name === "string" ? pkg.name : "app";
}

/** Output paths a module writes into a project (dot- convention applied). */
function moduleFilePaths(moduleDir: string, vars: TemplateVars): string[] {
  const filesDir = join(moduleDir, "files");
  if (!existsSync(filesDir)) return [];
  return [...renderTemplate(filesDir, vars).keys()];
}

/**
 * Remove a previously-added module from a generated project: the inverse of
 * `podo add`. Un-wires the module's marker injections, deletes its overlay files
 * (keeping any the user edited or another installed module also ships), prunes
 * the package.json deps/scripts and .env.example lines it introduced that no
 * other installed module still needs, then drops it from the manifest and
 * recomputes the lock. Does not cascade: a module still required by another
 * installed module is refused rather than force-removed.
 */
export function removeModule(options: RemoveOptions): RemoveResult {
  const { projectRoot, module, modulesDir } = options;
  const manifest = readManifest(projectRoot);
  if (!manifest) {
    throw new Error("Not a PodoKit project: .podokit/manifest.json not found.");
  }
  if (!manifest.modules.some((m) => m.name === module)) {
    const installed = manifest.modules.map((m) => m.name).join(", ") || "(none)";
    throw new Error(`Module "${module}" is not installed. Installed: ${installed}.`);
  }

  const moduleDir = resolveModuleDir(module, modulesDir, projectRoot);
  if (!moduleDir) {
    throw new Error(`Cannot resolve module "${module}" to un-apply it. Is it still installed/bundled?`);
  }
  const targetManifest = readModuleManifest(moduleDir);

  // Resolve the manifests of the OTHER installed modules once — used for the
  // requires guard and to decide which files/deps/env are shared.
  const others = manifest.modules
    .filter((m) => m.name !== module)
    .map((m) => {
      const dir = resolveModuleDir(m.name, modulesDir, projectRoot);
      return dir ? { name: m.name, dir, manifest: readModuleManifest(dir) } : null;
    })
    .filter((m): m is { name: string; dir: string; manifest: ModuleManifest } => m !== null);

  // Guard: refuse if another installed module requires this one.
  const dependents = others.filter((o) => (o.manifest.requires ?? []).includes(module)).map((o) => o.name);
  if (dependents.length) {
    throw new Error(
      `Cannot remove "${module}": required by ${dependents.join(", ")}. Remove ${dependents.length > 1 ? "those" : "that"} first.`,
    );
  }

  const vars: TemplateVars = { projectName: projectName(projectRoot) };
  const sharedFiles = new Set(others.flatMap((o) => moduleFilePaths(o.dir, vars)));
  const lock = readFilesLock(projectRoot);

  // 1) un-wire marker injections (idempotent; skips optional/absent).
  const unwired: string[] = [];
  for (const injection of targetManifest.inject ?? []) {
    const target = join(projectRoot, injection.file);
    if (!existsSync(target)) continue;
    const content = readFileSync(target, "utf8");
    const next = removeAtMarker(content, injection.text);
    if (next !== content) {
      writeFileSync(target, next);
      unwired.push(injection.file);
    }
  }

  // 2) delete overlay files, preserving edited and shared ones.
  const removed: string[] = [];
  const keptEdited: string[] = [];
  const keptShared: string[] = [];
  for (const rel of moduleFilePaths(moduleDir, vars)) {
    const abs = join(projectRoot, rel);
    if (!existsSync(abs)) continue;
    if (sharedFiles.has(rel)) {
      keptShared.push(rel);
      continue;
    }
    const locked = lock?.files[rel];
    if (locked && hashContent(readFileSync(abs)) !== locked.outHash) {
      keptEdited.push(rel);
      continue;
    }
    rmSync(abs);
    pruneEmptyDirs(projectRoot, dirname(rel));
    removed.push(rel);
  }

  // 3) prune package.json deps/scripts this module added that no other needs.
  pruneAppPackage(projectRoot, targetManifest, others);

  // 4) prune .env.example lines this module added that no other needs.
  pruneEnvExample(projectRoot, targetManifest, others);

  // 5) drop from the manifest (re-number order) and recompute the lock.
  manifest.modules = manifest.modules
    .filter((m) => m.name !== module)
    .map((m, i) => ({ ...m, order: i }));
  writeManifest(projectRoot, manifest);
  writeFilesLock(projectRoot, computeFilesLock(projectRoot, manifest.ownedGlobs));

  return { module, removed, keptEdited, keptShared, unwired };
}

/** Remove now-empty directories left behind by a deleted file, up to the root. */
function pruneEmptyDirs(projectRoot: string, relDir: string): void {
  let dir = relDir;
  while (dir && dir !== "." && dir !== "/") {
    const abs = join(projectRoot, dir);
    try {
      rmdirSync(abs); // removes only an empty directory; throws otherwise
    } catch {
      return; // not empty (or gone) — stop climbing
    }
    dir = dirname(dir);
  }
}

function pruneAppPackage(
  projectRoot: string,
  target: ModuleManifest,
  others: { manifest: ModuleManifest }[],
): void {
  if (!(target.dependencies || target.devDependencies || target.scripts)) return;
  const appPkgPath = join(projectRoot, "apps", target.targetApp, "package.json");
  if (!existsSync(appPkgPath)) return;
  const keep = (section: "dependencies" | "devDependencies" | "scripts"): Set<string> =>
    new Set(others.flatMap((o) => Object.keys(o.manifest[section] ?? {})));
  const pkg = readJson(appPkgPath);
  let changed = false;
  for (const section of ["dependencies", "devDependencies", "scripts"] as const) {
    const declared = target[section];
    const current = pkg[section] as Record<string, string> | undefined;
    if (!declared || !current) continue;
    const shared = keep(section);
    for (const name of Object.keys(declared)) {
      if (shared.has(name)) continue;
      if (name in current) {
        delete current[name];
        changed = true;
      }
    }
    if (current && Object.keys(current).length === 0) delete pkg[section];
  }
  if (changed) writeFileSync(appPkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function pruneEnvExample(
  projectRoot: string,
  target: ModuleManifest,
  others: { manifest: ModuleManifest }[],
): void {
  if (!target.env?.length) return;
  const file = join(projectRoot, ".env.example");
  if (!existsSync(file)) return;
  const shared = new Set(others.flatMap((o) => o.manifest.env ?? []));
  const drop = new Set(target.env.filter((line) => !shared.has(line)));
  if (!drop.size) return;
  const kept = readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => !drop.has(line));
  writeFileSync(file, kept.join("\n"));
}
