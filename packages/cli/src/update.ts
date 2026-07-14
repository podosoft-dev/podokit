import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { hashContent, threeWayMerge, type VfsTree } from "@podosoft/podokit-template-engine";
import { assembleProject } from "./assemble";
import {
  classifyTier,
  computeFilesLock,
  podokitVersion,
  readFilesLock,
  readManifest,
  writeFilesLock,
  writeManifest,
  type Tier,
  type FilesLock,
} from "./lockfile";
import { NotAProjectError } from "./inspect";
import { resolveModule } from "./add";

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

  const changes: FileChange[] = [];
  const paths = new Set<string>([...newTree.keys(), ...Object.keys(lock.files)]);

  for (const path of [...paths].sort()) {
    const locked = lock.files[path];
    const newText = treeText(newTree, path);
    const disk = diskContent(projectRoot, path);

    // tier: prefer the lock; else classify the new file.
    const tier: Tier =
      locked?.tier ??
      (newText !== null ? classifyTier(path, newText, manifest.ownedGlobs) : "managed");

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
): FilesLock {
  const next = computeFilesLock(projectRoot, ownedGlobs);

  for (const [path, entry] of Object.entries(next.files)) {
    const newText = treeText(newTree, path);
    if (newText !== null) {
      if (entry.tier !== "owned") {
        entry.tier = previous.files[path]?.tier ?? entry.tier;
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
  const oldTree = options.oldTemplatesDir
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
  writeFilesLock(projectRoot, updatedFilesLock(projectRoot, newTree, previousLock, manifest.ownedGlobs));
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
