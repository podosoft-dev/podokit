import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  hashContent,
  threeWayMerge,
  type TemplateVars,
  type VfsTree,
} from "@podosoft/podokit-template-engine";
import { assembleProject } from "./assemble";
import {
  classifyTier,
  computeFilesLock,
  DEFAULT_OWNED_GLOBS,
  matchGlob,
  manifestTemplateVars,
  podokitVersion,
  readFilesLock,
  readManifest,
  writeFilesLock,
  writeManifest,
  type Tier,
  type FilesLock,
  type ManifestModule,
} from "./lockfile";
import type { Toolchain } from "./toolchain";
import { NotAProjectError } from "./inspect";
import { readModuleManifest, resolveModule } from "./add";
import {
  applyModuleMigrations,
  collectPendingMigrations,
  migrateConfiguredPath,
  planModuleMigrations,
} from "./module-migrations";

/**
 * `podo update` planner. For now it produces a dry-run plan only: it assembles
 * the new-version tree from the installed CLI's templates and compares it to the
 * working copy, classifying each file. Applying the plan (writing files, 3-way
 * merging) is a later step (see ADR-0009).
 */

export type Action =
  | "update"
  | "merge"
  | "conflict"
  | "add"
  | "move"
  | "remove"
  | "skip"
  | "up-to-date";

export interface FileChange {
  path: string;
  /** Previous path when this change is an update migration move. */
  fromPath?: string;
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
 * Expand the recorded module list against the target manifests. A module may
 * gain a new requirement after it was first added to a project; updates must
 * apply that requirement before rebuilding the dependent module or the target
 * tree can contain imports and wiring for files that were never installed.
 */
function targetModules(
  projectRoot: string,
  templatesDir: string,
  modules: ManifestModule[],
): ManifestModule[] {
  const modulesDir = join(templatesDir, "modules");
  const recorded = new Map(modules.map((module) => [module.name, module]));
  const ordered: ManifestModule[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (name: string, requiredBy?: string): void => {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      throw new Error(`Module dependency cycle detected at "${name}".`);
    }

    const existing = recorded.get(name);
    const resolved = resolveModule(existing?.packageName ?? name, modulesDir, projectRoot);
    if (!resolved) {
      throw new Error(
        requiredBy
          ? `Module "${requiredBy}" requires unknown module "${name}".`
          : `Cannot resolve module "${name}" while updating the project.`,
      );
    }

    visiting.add(name);
    const moduleManifest = readModuleManifest(resolved.dir);
    for (const required of moduleManifest.requires ?? []) visit(required, name);
    visiting.delete(name);
    visited.add(name);

    ordered.push({
      ...(existing ?? {
        name: resolved.name,
        addedWith: podokitVersion(),
      }),
      order: ordered.length,
      ...(resolved.packageName
        ? {
            packageName: resolved.packageName,
            moduleVersion: resolved.moduleVersion,
          }
        : {}),
    });
  };

  for (const module of [...modules].sort((a, b) => a.order - b.order)) {
    visit(module.name);
  }
  return ordered;
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
export interface PlanOptions {
  /** Replay variables for a toolchain conversion instead of the current answers. */
  targetAnswers?: TemplateVars;
  /** Treat normally owned runtime scaffolding as managed for this operation. */
  forceManagedPaths?: string[];
  /** Restrict planning to selected paths, used by focused conversions. */
  onlyPaths?: string[];
}

export function planUpdate(
  projectRoot: string,
  templatesDir: string,
  options: PlanOptions = {},
): UpdatePlan {
  const manifest = readManifest(projectRoot);
  const lock = readFilesLock(projectRoot);
  if (!manifest || !lock) throw new NotAProjectError();
  const modules = targetModules(projectRoot, templatesDir, manifest.modules);

  const newTree = assembleProject({
    templatesDir,
    template: manifest.template,
    answers: options.targetAnswers ?? manifestTemplateVars(manifest),
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
  const pendingMigrations = collectPendingMigrations(
    projectRoot,
    templatesDir,
    modules,
  );
  const migrationPlan = planModuleMigrations(
    projectRoot,
    newTree,
    lock,
    pendingMigrations,
  );

  const changes: FileChange[] = migrationPlan.moves.map((move) => ({
    path: move.to,
    fromPath: move.from,
    tier: move.tier,
    action: "move",
    note: "module path migration",
  }));
  for (const conflict of migrationPlan.conflicts) {
    changes.push({
      path: "module migration",
      tier: "managed",
      action: "conflict",
      note: conflict,
    });
  }
  const movedSources = new Set(migrationPlan.moves.map((move) => move.from));
  const movedTargets = new Set(migrationPlan.moves.map((move) => move.to));
  const paths = new Set<string>([...newTree.keys(), ...Object.keys(lock.files)]);

  for (const path of [...paths].sort()) {
    if (movedSources.has(path) || movedTargets.has(path)) continue;
    if (options.onlyPaths && !options.onlyPaths.some((glob) => matchGlob(path, glob))) continue;
    const locked = lock.files[path];
    const newText = treeText(newTree, path);
    const disk = diskContent(projectRoot, path);

    // Use the same ownership precedence as lockfile classification. In
    // particular, an exact path recorded by `podo eject` must keep winning over
    // a module's managed override, while managed overrides may still reclaim a
    // path covered only by a broad owned glob.
    const forceManaged = options.forceManagedPaths?.some((glob) => matchGlob(path, glob)) ?? false;
    const controlledByTarget =
      managedOverrides.some((glob) => matchGlob(path, glob)) ||
      ownedGlobs.some((glob) => matchGlob(path, glob));
    const classified = classifyTier(
      path,
      newText ?? disk ?? "",
      ownedGlobs,
      managedOverrides,
    );
    const tier: Tier = forceManaged
      ? "managed"
      : controlledByTarget
        ? classified
        : locked?.tier ?? classified;

    if (tier === "owned") {
      // A file introduced by a newer template or module has no previous lock
      // entry. Seed it once when the application has not already claimed that
      // path; subsequent edits or deletions stay protected by the recorded
      // owned entry.
      if (!locked && disk === null && newText !== null) {
        changes.push({ path, tier, action: "add", note: "new owned seed in this version" });
        continue;
      }
      const explicitlyOwned = ownedGlobs.some(
        (glob) => !glob.includes("*") && matchGlob(path, glob),
      );
      changes.push({
        path,
        tier,
        action: "skip",
        note:
          explicitlyOwned && disk === null && newText !== null
            ? "explicitly owned — missing or relocated; not restored"
            : "owned — never modified",
      });
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
    modules: modules.map((module) => module.name),
    changes,
  };
}

export interface ApplyOptions {
  /** Templates for the version the project is currently on, for 3-way merges. */
  oldTemplatesDir?: string;
  /** Preinstalled previous external modules. Primarily useful for offline updates. */
  oldExternalModulesRoot?: string;
  /** Replay variables and manifest value used by a runtime conversion. */
  targetAnswers?: TemplateVars;
  targetToolchain?: Toolchain;
  forceManagedPaths?: string[];
  onlyPaths?: string[];
  /** Refuse to write anything when a 3-way merge would leave conflict markers. */
  abortOnConflict?: boolean;
}

export interface ApplyResult {
  written: string[];
  /** Files relocated by module update migrations. */
  moved: { from: string; to: string }[];
  removed: string[];
  /** Files 3-way merged cleanly. */
  merged: string[];
  /** Files written with conflict markers for manual resolution. */
  conflicts: string[];
}

function assertRecordedExternalModules(
  moduleRoot: string,
  templatesDir: string,
  modules: { name: string; packageName?: string; moduleVersion?: string }[],
): void {
  const modulesDir = join(templatesDir, "modules");
  for (const module of modules) {
    if (!module.packageName || !module.moduleVersion) continue;
    const resolved = resolveModule(module.packageName, modulesDir, moduleRoot);
    if (resolved?.moduleVersion === module.moduleVersion) continue;
    const actual = resolved?.moduleVersion ?? "not installed";
    throw new Error(
      `Previous external module root has ${module.packageName} at ${actual}; ` +
        `expected ${module.moduleVersion} from the project manifest.`,
    );
  }
}

interface PreviousExternalModules {
  root: string;
  cleanup: boolean;
}

function previousExternalModules(
  projectRoot: string,
  templatesDir: string,
  modules: { name: string; packageName?: string; moduleVersion?: string }[],
  providedRoot?: string,
): PreviousExternalModules {
  const external = modules.filter(
    (module): module is { name: string; packageName: string; moduleVersion: string } =>
      Boolean(module.packageName && module.moduleVersion),
  );
  if (!external.length) return { root: projectRoot, cleanup: false };

  if (providedRoot) {
    assertRecordedExternalModules(providedRoot, templatesDir, external);
    return { root: providedRoot, cleanup: false };
  }

  const currentMatchesRecorded = external.every((module) => {
    const resolved = resolveModule(module.packageName, join(templatesDir, "modules"), projectRoot);
    return resolved?.moduleVersion === module.moduleVersion;
  });
  if (currentMatchesRecorded) return { root: projectRoot, cleanup: false };

  const root = mkdtempSync(join(tmpdir(), "podokit-update-modules-"));
  const devDependencies = Object.fromEntries(
    external.map((module) => [module.packageName, module.moduleVersion]),
  );
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name: "podokit-update-modules", private: true, devDependencies }, null, 2)}\n`,
  );
  try {
    execFileSync(
      "npm",
      ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false"],
      { cwd: root, stdio: "pipe" },
    );
    assertRecordedExternalModules(root, templatesDir, external);
  } catch {
    rmSync(root, { recursive: true, force: true });
    const expected = external.map((module) => `${module.packageName}@${module.moduleVersion}`).join(", ");
    throw new Error(
      `Cannot install previous external modules (${expected}) for the 3-way merge. ` +
        "Check npm registry access and try again.",
    );
  }
  return { root, cleanup: true };
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
  onlyPaths?: string[],
): FilesLock {
  const next = computeFilesLock(projectRoot, ownedGlobs, managedOverrides);

  for (const [path, entry] of Object.entries(next.files)) {
    if (onlyPaths && !onlyPaths.some((glob) => matchGlob(path, glob))) {
      const previousEntry = previous.files[path];
      if (previousEntry) next.files[path] = previousEntry;
      else delete next.files[path];
      continue;
    }
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

  // Keep a tombstone for an owned seed that the application deleted or moved.
  // Without the previous entry, the next update would mistake the missing path
  // for a newly introduced seed and recreate it.
  for (const [path, entry] of Object.entries(previous.files)) {
    if (entry.tier !== "owned" || next.files[path]) continue;
    const newText = treeText(newTree, path);
    if (
      newText !== null &&
      classifyTier(path, newText, ownedGlobs, managedOverrides) === "owned"
    ) {
      next.files[path] = entry;
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
  const plan = planUpdate(projectRoot, templatesDir, {
    targetAnswers: options.targetAnswers,
    forceManagedPaths: options.forceManagedPaths,
    onlyPaths: options.onlyPaths,
  });
  const modules = targetModules(projectRoot, templatesDir, manifest.modules);
  const newTree = assembleProject({
    templatesDir,
    template: manifest.template,
    answers: options.targetAnswers ?? manifestTemplateVars(manifest),
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
  const pendingMigrations = collectPendingMigrations(projectRoot, templatesDir, modules);
  const migrationPlan = planModuleMigrations(
    projectRoot,
    newTree,
    previousLock,
    pendingMigrations,
  );
  if (migrationPlan.conflicts.length) {
    throw new Error(
      `Cannot apply module path migration:\n${migrationPlan.conflicts
        .map((conflict) => `  - ${conflict}`)
        .join("\n")}`,
    );
  }
  const migratedOwnedGlobs = [
    ...new Set(ownedGlobs.map((glob) => migrateConfiguredPath(glob, pendingMigrations))),
  ];
  const migratedManagedOverrides = [
    ...new Set(
      managedOverrides.map((glob) => migrateConfiguredPath(glob, pendingMigrations)),
    ),
  ];
  const needsMergeBase = plan.changes.some((change) => change.action === "conflict");
  let oldTree: VfsTree | null = null;
  if (options.oldTemplatesDir && needsMergeBase) {
    const previousModules = previousExternalModules(
      projectRoot,
      options.oldTemplatesDir,
      manifest.modules,
      options.oldExternalModulesRoot,
    );
    try {
      oldTree = assembleProject({
        templatesDir: options.oldTemplatesDir,
        template: manifest.template,
        answers: manifestTemplateVars(manifest),
        modules: manifest.modules,
        projectRoot: previousModules.root,
      });
    } finally {
      if (previousModules.cleanup) rmSync(previousModules.root, { recursive: true, force: true });
    }
  }

  if (options.abortOnConflict) {
    const unresolved: string[] = [];
    for (const change of plan.changes) {
      if (change.action !== "conflict") continue;
      const next = treeText(newTree, change.path);
      const base = oldTree ? treeText(oldTree, change.path) : null;
      const current = diskContent(projectRoot, change.path)?.toString("utf8") ?? null;
      if (next === null || base === null || current === null) {
        unresolved.push(change.path);
        continue;
      }
      if (threeWayMerge(base, current, next).conflicts > 0) unresolved.push(change.path);
    }
    if (unresolved.length) {
      throw new Error(
        `Runtime conversion would conflict with local edits:\n${unresolved
          .map((path) => `  - ${path}`)
          .join("\n")}`,
      );
    }
  }

  const result: ApplyResult = {
    written: [],
    moved: applyModuleMigrations(projectRoot, migrationPlan),
    removed: [],
    merged: [],
    conflicts: [],
  };

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
      migratedOwnedGlobs,
      migratedManagedOverrides,
      options.onlyPaths,
    ),
  );
  const modulesDir = join(templatesDir, "modules");
  const appliedMigrations = new Map<string, string[]>();
  for (const pending of pendingMigrations) {
    const ids = appliedMigrations.get(pending.module) ?? [];
    ids.push(pending.migration.id);
    appliedMigrations.set(pending.module, ids);
  }
  const refreshedModules = modules.map((module) => {
    const resolved = resolveModule(module.packageName ?? module.name, modulesDir, projectRoot);
    const applied = [
      ...new Set([
        ...(module.appliedMigrations ?? []),
        ...(appliedMigrations.get(module.name) ?? []),
      ]),
    ];
    return {
      ...module,
      ...(resolved?.packageName
        ? {
            packageName: resolved.packageName,
            moduleVersion: resolved.moduleVersion,
          }
        : {}),
      ...(applied.length ? { appliedMigrations: applied } : {}),
    };
  });
  writeManifest(projectRoot, {
    ...manifest,
    answers: options.targetAnswers ?? manifestTemplateVars(manifest),
    toolchain: options.targetToolchain ?? manifest.toolchain,
    packageManager: undefined,
    ownedGlobs: migratedOwnedGlobs,
    managedOverrides: migratedManagedOverrides,
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
    move: 0,
    remove: 0,
    skip: 0,
    "up-to-date": 0,
  };
  for (const change of plan.changes) counts[change.action] += 1;
  return counts;
}
