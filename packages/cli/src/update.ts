import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { hashContent, threeWayMerge, type VfsTree } from "@podosoft/podokit-template-engine";
import { assembleProject } from "./assemble";
import {
  classifyTier,
  computeFilesLock,
  DEFAULT_OWNED_GLOBS,
  matchGlob,
  podokitVersion,
  readFilesLock,
  readManifest,
  writeFilesLock,
  writeManifest,
  type Tier,
  type FilesLock,
} from "./lockfile";
import { NotAProjectError } from "./inspect";
import { readModuleManifest, resolveModule } from "./add";

/**
 * `podo update` planner. For now it produces a dry-run plan only: it assembles
 * the new-version tree from the installed CLI's templates and compares it to the
 * working copy, classifying each file. Applying the plan (writing files, 3-way
 * merging) is a later step (see ADR-0009).
 */

export type Action = "update" | "merge" | "conflict" | "add" | "remove" | "skip" | "up-to-date";

export interface FileChange {
  path: string;
  tier: Tier;
  action: Action;
  /** Why the action was chosen (for the report). */
  note: string;
}

export interface UpdatePlan {
  fromVersion: string;
  toVersion: string;
  template: string;
  modules: string[];
  changes: FileChange[];
}

function treeText(tree: VfsTree, path: string): string | null {
  const file = tree.get(path);
  if (!file) return null;
  return typeof file.content === "string" ? file.content : file.content.toString("utf8");
}

function diskContent(projectRoot: string, path: string): Buffer | null {
  const abs = join(projectRoot, path);
  return existsSync(abs) ? readFileSync(abs) : null;
}

function targetManagedOverrides(
  projectRoot: string,
  templatesDir: string,
  modules: { name: string; packageName?: string }[],
  current: string[] = [],
): string[] {
  const overrides = new Set(current);
  const modulesDir = join(templatesDir, "modules");
  for (const module of modules) {
    const resolved = resolveModule(module.packageName ?? module.name, modulesDir, projectRoot);
    if (!resolved) continue;
    for (const glob of readModuleManifest(resolved.dir).managedOverrides ?? []) overrides.add(glob);
  }
  return [...overrides];
}

function targetOwnedGlobs(
  projectRoot: string,
  templatesDir: string,
  modules: { name: string; packageName?: string }[],
  current: string[],
): string[] {
  const owned = new Set([...DEFAULT_OWNED_GLOBS, ...current]);
  const modulesDir = join(templatesDir, "modules");
  for (const module of modules) {
    const resolved = resolveModule(module.packageName ?? module.name, modulesDir, projectRoot);
    if (!resolved) continue;
    for (const glob of readModuleManifest(resolved.dir).ownedGlobs ?? []) owned.add(glob);
  }
  return [...owned];
}

/**
 * Build the update plan. `templatesDir` is the installed CLI's template set (the
 * new version); the lock records what PodoKit last wrote (to detect user edits).
 */
export function planUpdate(projectRoot: string, templatesDir: string): UpdatePlan {
  const manifest = readManifest(projectRoot);
  const lock = readFilesLock(projectRoot);
  if (!manifest || !lock) throw new NotAProjectError();

  const newTree = assembleProject({
    templatesDir,
    template: manifest.template,
    answers: manifest.answers,
    modules: manifest.modules,
    projectRoot,
  });
  const managedOverrides = targetManagedOverrides(
    projectRoot,
    templatesDir,
    manifest.modules,
    manifest.managedOverrides,
  );
  const ownedGlobs = targetOwnedGlobs(projectRoot, templatesDir, manifest.modules, manifest.ownedGlobs);

  const changes: FileChange[] = [];
  const paths = new Set<string>([...newTree.keys(), ...Object.keys(lock.files)]);

  for (const path of [...paths].sort()) {
    const locked = lock.files[path];
    const newText = treeText(newTree, path);
    const disk = diskContent(projectRoot, path);

    // A newer module can explicitly take responsibility for a path that older
    // projects classified under a broad owned glob (notably generated skills).
    const managedByTarget = managedOverrides.some((glob) => matchGlob(path, glob));
    const ownedByTarget = ownedGlobs.some((glob) => matchGlob(path, glob));
    const tier: Tier = managedByTarget
      ? "managed"
      : ownedByTarget
        ? "owned"
        : locked?.tier ??
        (newText !== null
          ? classifyTier(path, newText, ownedGlobs, managedOverrides)
          : "managed");

    if (tier === "owned") {
      changes.push({ path, tier, action: "skip", note: "owned — never modified" });
      continue;
    }

    // File removed upstream.
    if (newText === null) {
      if (disk === null) continue; // already gone
      const edited = locked && hashContent(disk) !== locked.outHash;
      changes.push({
        path,
        tier,
        action: edited ? "conflict" : "remove",
        note: edited ? "removed upstream but edited locally" : "removed upstream",
      });
      continue;
    }

    const newHash = hashContent(newText);

    // New file added upstream.
    if (disk === null) {
      changes.push({ path, tier, action: "add", note: "new in this version" });
      continue;
    }

    const diskHash = hashContent(disk);
    if (diskHash === newHash) {
      changes.push({ path, tier, action: "up-to-date", note: "already current" });
      continue;
    }

    const edited = !locked || diskHash !== locked.outHash;
    changes.push({
      path,
      tier,
      action: edited ? "conflict" : "update",
      note: edited ? "you edited this; update would need a merge" : "clean update",
    });
  }

  return {
    fromVersion: manifest.podokitVersion,
    toVersion: podokitVersion(),
    template: manifest.template,
    modules: manifest.modules.map((m) => m.name),
    changes,
  };
}

export interface ApplyOptions {
  /** Templates for the version the project is currently on, for 3-way merges. */
  oldTemplatesDir?: string;
}

export interface ApplyResult {
  written: string[];
  removed: string[];
  /** Files 3-way merged cleanly. */
  merged: string[];
  /** Files written with conflict markers for manual resolution. */
  conflicts: string[];
}

function assertPreviousExternalModulesInstalled(
  projectRoot: string,
  templatesDir: string,
  modules: { name: string; packageName?: string; moduleVersion?: string }[],
): void {
  const modulesDir = join(templatesDir, "modules");
  for (const module of modules) {
    if (!module.packageName || !module.moduleVersion) continue;
    const resolved = resolveModule(module.packageName, modulesDir, projectRoot);
    if (!resolved?.moduleVersion || resolved.moduleVersion === module.moduleVersion) continue;
    throw new Error(
      `Cannot use --from while external module "${module.packageName}" is installed at ` +
        `${resolved.moduleVersion} but the project records ${module.moduleVersion}. Restore ` +
        `${module.packageName}@${module.moduleVersion}, update PodoKit with --from, then upgrade ` +
        "external modules separately.",
    );
  }
}

function writeFile(projectRoot: string, path: string, content: string): void {
  const abs = join(projectRoot, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

/**
 * Refresh update metadata without teaching the lock that a clean 3-way merge is
 * PodoKit's new baseline. Managed files keep the newly assembled template hash,
 * so the user's merged lines are still recognised as edits on the next update.
 * Files that are neither in the assembled tree nor explicitly owned stay out of
 * the lock instead of being accidentally adopted as managed files.
 */
function updatedFilesLock(
  projectRoot: string,
  newTree: VfsTree,
  previous: FilesLock,
  ownedGlobs: string[],
  managedOverrides: string[],
): FilesLock {
  const next = computeFilesLock(projectRoot, ownedGlobs, managedOverrides);

  for (const [path, entry] of Object.entries(next.files)) {
    const newText = treeText(newTree, path);
    if (newText !== null) {
      if (entry.tier !== "owned") {
        if (!managedOverrides.some((glob) => matchGlob(path, glob))) {
          entry.tier = previous.files[path]?.tier ?? entry.tier;
        }
        entry.outHash = hashContent(newText);
      }
      continue;
    }

    if (entry.tier === "owned") continue;

    const oldEntry = previous.files[path];
    if (oldEntry && oldEntry.tier !== "owned") {
      // Removed upstream but kept on disk because it was edited: continue to
      // report the removal conflict until the user deletes or ejects it.
      entry.tier = oldEntry.tier;
      entry.outHash = oldEntry.outHash;
    } else {
      // A file created by the application is not implicitly PodoKit-managed.
      delete next.files[path];
    }
  }

  return next;
}

/**
 * Apply an update to the working copy. Clean updates and additions are written,
 * upstream removals deleted, and user-edited files 3-way merged against the old
 * version (when `oldTemplatesDir` is given) or written with git-style conflict
 * markers otherwise. Owned files are never touched. Refreshes the lockfile and
 * stamps the new version.
 */
export function applyUpdate(
  projectRoot: string,
  templatesDir: string,
  options: ApplyOptions = {},
): ApplyResult {
  const manifest = readManifest(projectRoot);
  const previousLock = readFilesLock(projectRoot);
  if (!manifest || !previousLock) throw new NotAProjectError();
  const plan = planUpdate(projectRoot, templatesDir);
  const modules = manifest.modules;
  const newTree = assembleProject({
    templatesDir,
    template: manifest.template,
    answers: manifest.answers,
    modules,
    projectRoot,
  });
  const managedOverrides = targetManagedOverrides(
    projectRoot,
    templatesDir,
    modules,
    manifest.managedOverrides,
  );
  const ownedGlobs = targetOwnedGlobs(projectRoot, templatesDir, modules, manifest.ownedGlobs);
  const needsMergeBase = plan.changes.some((change) => change.action === "conflict");
  if (options.oldTemplatesDir && needsMergeBase) {
    assertPreviousExternalModulesInstalled(projectRoot, templatesDir, modules);
  }
  const oldTree = options.oldTemplatesDir && needsMergeBase
    ? assembleProject({
        templatesDir: options.oldTemplatesDir,
        template: manifest.template,
        answers: manifest.answers,
        modules,
        projectRoot,
      })
    : null;

  const result: ApplyResult = { written: [], removed: [], merged: [], conflicts: [] };

  for (const change of plan.changes) {
    const newText = treeText(newTree, change.path);
    if (change.action === "update" || change.action === "add") {
      writeFile(projectRoot, change.path, newText ?? "");
      result.written.push(change.path);
    } else if (change.action === "remove") {
      rmSync(join(projectRoot, change.path), { force: true });
      result.removed.push(change.path);
    } else if (change.action === "conflict" && newText !== null) {
      const disk = readFileSync(join(projectRoot, change.path), "utf8");
      const base = oldTree ? treeText(oldTree, change.path) : null;
      if (base === null) {
        // No old version to merge against — never clobber the user's edits.
        result.conflicts.push(change.path);
        continue;
      }
      const merge = threeWayMerge(base, disk, newText, { current: "current", next: "podokit" });
      writeFile(projectRoot, change.path, merge.merged);
      if (merge.conflicts > 0) result.conflicts.push(change.path);
      else result.merged.push(change.path);
    }
  }

  // Keep the assembled target as the managed baseline. A merged working file
  // intentionally remains drifted so a future update performs another 3-way
  // merge instead of treating the user's lines as clean generated output.
  writeFilesLock(
    projectRoot,
    updatedFilesLock(
      projectRoot,
      newTree,
      previousLock,
      ownedGlobs,
      managedOverrides,
    ),
  );
  const modulesDir = join(templatesDir, "modules");
  const refreshedModules = manifest.modules.map((module) => {
    const resolved = resolveModule(module.packageName ?? module.name, modulesDir, projectRoot);
    return resolved?.packageName
      ? {
          ...module,
          packageName: resolved.packageName,
          moduleVersion: resolved.moduleVersion,
        }
      : module;
  });
  writeManifest(projectRoot, {
    ...manifest,
    ownedGlobs,
    managedOverrides,
    modules: refreshedModules,
    podokitVersion: podokitVersion(),
  });
  return result;
}

/** Count actions for a one-line summary. */
export function summarize(plan: UpdatePlan): Record<Action, number> {
  const counts: Record<Action, number> = {
    update: 0,
    merge: 0,
    conflict: 0,
    add: 0,
    remove: 0,
    skip: 0,
    "up-to-date": 0,
  };
  for (const change of plan.changes) counts[change.action] += 1;
  return counts;
}
