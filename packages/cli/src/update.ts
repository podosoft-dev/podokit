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
} from "./lockfile";
import { NotAProjectError } from "./inspect";

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
    modules: manifest.modules.map((m) => m.name),
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
  if (!manifest) throw new NotAProjectError();
  const plan = planUpdate(projectRoot, templatesDir);
  const modules = manifest.modules.map((m) => m.name);
  const newTree = assembleProject({ templatesDir, template: manifest.template, answers: manifest.answers, modules });
  const oldTree = options.oldTemplatesDir
    ? assembleProject({ templatesDir: options.oldTemplatesDir, template: manifest.template, answers: manifest.answers, modules })
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

  // Refresh the lock to match what we just wrote and stamp the new version.
  writeFilesLock(projectRoot, computeFilesLock(projectRoot, manifest.ownedGlobs));
  writeManifest(projectRoot, { ...manifest, podokitVersion: podokitVersion() });
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
