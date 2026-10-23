import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  hashContent,
  threeWayMerge,
  type MergeResult,
  type TemplateVars,
  type VfsTree,
} from "@podosoft/podokit-template-engine";
import { assembleProject } from "./assemble";
import { unifiedDiff } from "./text-diff";
import {
  classifyTier,
  computeFilesLock,
  DEFAULT_MANAGED_OVERRIDES,
  DEFAULT_OWNED_GLOBS,
  matchGlob,
  manifestTemplateVars,
  podokitVersion,
  readFilesLock,
  readManifest,
  recordedTemplateHash,
  writeFilesLock,
  writeManifest,
  type Tier,
  type FilesLock,
  type ManifestModule,
  type PodokitManifest,
} from "./lockfile";
import type { ProviderCapability, ProviderSelections } from "@podosoft/podokit-runtime";
import { BUN_VERSION, type Toolchain } from "./toolchain";
import { NotAProjectError } from "./inspect";
import { retiredClientAddressKeys } from "./deploy-schema";
import {
  readModuleManifest,
  resolveModule,
  selectedProviderModule,
  unresolvedModuleMessage,
} from "./add";
import {
  applyModuleMigrations,
  collectPendingMigrations,
  migrateConfiguredPath,
  planModuleMigrations,
} from "./module-migrations";
import {
  addApiPaths,
  pendingApiPaths,
  type ApiPathResult,
  type ModuleApiPath,
} from "./module-api-paths";

/**
 * `podo update` planner. For now it produces a dry-run plan only: it assembles
 * the new-version tree from the installed CLI's templates and compares it to the
 * working copy, classifying each file. Applying the plan (writing files, 3-way
 * merging) is a later step (see ADR-0009).
 */

/**
 * What an update does to a file. `keep` is an edited file with nothing to merge
 * into it (its template did not change, or this version stops generating it);
 * `merge` is an edited file whose template changed too, so applying 3-way
 * merges it. `conflict` is a known blocker: a module path migration that cannot
 * apply, or a merge that `predictMerges` found would leave conflict markers.
 */
export type Action =
  | "review"
  | "update"
  | "merge"
  | "conflict"
  | "keep"
  | "add"
  | "move"
  | "remove"
  | "skip"
  | "up-to-date";

const EDITED_TEMPLATE_UNCHANGED = "edited locally; the template did not change, so your version stays";
const REMOVED_BUT_EDITED = "removed upstream but edited locally; kept, delete it when you no longer need it";
const MERGES_CLEANLY = "edited locally and the template changed; merges cleanly";
const MERGE_CONFLICTS = "edited locally and the template changed; the merge leaves conflict markers to resolve";

function noMergeBase(path: string): string {
  return `the previous version's templates do not generate it, so there is no merge base; compare it with podo diff ${path}`;
}

export interface FileChange {
  path: string;
  /** Previous path when this change is an update migration move. */
  fromPath?: string;
  tier: Tier;
  action: Action;
  /** Why the action was chosen (for the report). */
  note: string;
}

/** A module the target version needs that the project does not record yet. */
export interface AddedModule {
  name: string;
  /** Installed or added module that needs it. */
  requiredBy: string;
  /** Provider capability it implements, when added for a capability requirement. */
  capability?: ProviderCapability;
  /** Selected provider it implements. */
  provider?: string;
}

export interface UpdatePlan {
  fromVersion: string;
  toVersion: string;
  template: string;
  modules: string[];
  /** Modules the update adds, ordered ahead of the modules that need them. */
  addedModules: AddedModule[];
  /**
   * External modules whose installed package is older than the version the
   * project last applied. Applying would write the older module's files, so
   * `applyUpdate` refuses while this is not empty.
   */
  moduleDowngrades: ModuleDowngrade[];
  changes: FileChange[];
  /** Direct API paths that modules newly declare, per configuration file. */
  apiPaths: ApiPathResult;
  /**
   * Owned files that differ from this version's template while the lock has no
   * record of the template they came from, so PodoKit cannot tell whether the
   * template changed. Applying the update records it for the next one.
   */
  ownedWithoutTemplate: string[];
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

/** An external module installed at an older version than the project last applied. */
export interface ModuleDowngrade {
  name: string;
  packageName: string;
  /** Version recorded in the manifest. */
  recorded: string;
  /** Version installed in node_modules. */
  installed: string;
}

interface TargetModules {
  modules: ManifestModule[];
  added: AddedModule[];
  downgrades: ModuleDowngrade[];
}

function versionParts(version: string): { core: number[]; prerelease: string | null } {
  const [withoutBuild = ""] = version.split("+");
  const dash = withoutBuild.indexOf("-");
  const core = (dash === -1 ? withoutBuild : withoutBuild.slice(0, dash))
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
  return { core, prerelease: dash === -1 ? null : withoutBuild.slice(dash + 1) };
}

/** Semantic version order of two exact versions: negative when `a` is older. */
export function compareVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let index = 0; index < Math.max(left.core.length, right.core.length); index += 1) {
    const difference = (left.core[index] ?? 0) - (right.core[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  return left.prerelease.localeCompare(right.prerelease, "en", { numeric: true });
}

/**
 * Expand the recorded module list against the target manifests. A module may
 * gain a new requirement after it was first added to a project, either another
 * module or a provider capability. Updates must apply that requirement before
 * the dependent module: modules configure in this order, and the target tree
 * would otherwise wire files that were never installed. A capability resolves
 * to the module implementing the project's selected provider, as `podo add`
 * would choose it.
 */
function targetModules(
  projectRoot: string,
  templatesDir: string,
  modules: ManifestModule[],
  providers: ProviderSelections,
): TargetModules {
  const modulesDir = join(templatesDir, "modules");
  const recorded = new Map(modules.map((module) => [module.name, module]));
  const ordered: ManifestModule[] = [];
  const added: AddedModule[] = [];
  const downgrades: ModuleDowngrade[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (name: string, requiredBy?: string, capability?: ProviderCapability): void => {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      throw new Error(`Module dependency cycle detected at "${name}".`);
    }

    const existing = recorded.get(name);
    const resolved = resolveModule(existing?.packageName ?? name, modulesDir, projectRoot);
    if (!resolved) {
      throw new Error(
        existing
          ? unresolvedModuleMessage(existing, projectRoot)
          : `Module "${requiredBy}" requires unknown module "${name}".`,
      );
    }

    if (
      existing?.moduleVersion &&
      resolved.packageName &&
      resolved.moduleVersion &&
      compareVersions(resolved.moduleVersion, existing.moduleVersion) < 0
    ) {
      downgrades.push({
        name: resolved.name,
        packageName: resolved.packageName,
        recorded: existing.moduleVersion,
        installed: resolved.moduleVersion,
      });
    }
    visiting.add(name);
    const moduleManifest = readModuleManifest(resolved.dir);
    for (const required of moduleManifest.requires ?? []) visit(required, name);
    for (const required of moduleManifest.requiresCapabilities ?? []) {
      visit(selectedProviderModule(modulesDir, projectRoot, providers, required), name, required);
    }
    visiting.delete(name);
    visited.add(name);

    if (!existing && requiredBy) {
      added.push({
        name: resolved.name,
        requiredBy,
        ...(capability ? { capability, provider: providers[capability] } : {}),
      });
    }
    ordered.push({
      ...(existing ?? {
        name: resolved.name,
        addedWith: podokitVersion(),
        // A freshly added module ships its current layout, as `podo add` records it.
        appliedMigrations: (moduleManifest.migrations ?? []).map((migration) => migration.id),
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
  return { modules: ordered, added, downgrades };
}

interface TargetApiPaths {
  /** Every path each target module declares, by module name. */
  declared: Map<string, string[]>;
  /** Declared paths the project has not merged yet. */
  pending: ModuleApiPath[];
}

function targetApiPaths(
  projectRoot: string,
  templatesDir: string,
  modules: ManifestModule[],
): TargetApiPaths {
  const modulesDir = join(templatesDir, "modules");
  const declared = new Map<string, string[]>();
  const pending: ModuleApiPath[] = [];
  for (const module of modules) {
    const resolved = resolveModule(module.packageName ?? module.name, modulesDir, projectRoot);
    const paths = resolved ? (readModuleManifest(resolved.dir).apiPaths ?? []) : [];
    declared.set(module.name, paths);
    pending.push(...pendingApiPaths(module, paths));
  }
  return { declared, pending };
}

function targetManagedOverrides(
  projectRoot: string,
  templatesDir: string,
  modules: { name: string; packageName?: string }[],
  current: string[] = [],
): string[] {
  const overrides = new Set([...DEFAULT_MANAGED_OVERRIDES, ...current]);
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

/** Owned paths the template and the installed modules declare, without the app's own. */
export function declaredOwnedGlobs(
  projectRoot: string,
  templatesDir: string,
  modules: { name: string; packageName?: string }[],
): string[] {
  return targetOwnedGlobs(projectRoot, templatesDir, modules, []);
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

/** The project as the installed CLI's templates would generate it. */
export interface TargetProject {
  manifest: PodokitManifest;
  lock: FilesLock;
  /** Recorded modules plus any the target version requires, in configure order. */
  modules: ManifestModule[];
  addedModules: AddedModule[];
  /** External modules installed at an older version than the project applied. */
  moduleDowngrades: ModuleDowngrade[];
  tree: VfsTree;
  ownedGlobs: string[];
  managedOverrides: string[];
}

export function targetProject(
  projectRoot: string,
  templatesDir: string,
  targetAnswers?: TemplateVars,
): TargetProject {
  const manifest = readManifest(projectRoot);
  const lock = readFilesLock(projectRoot);
  if (!manifest || !lock) throw new NotAProjectError();
  const { modules, added, downgrades } = targetModules(
    projectRoot,
    templatesDir,
    manifest.modules,
    manifest.providers,
  );
  const tree = assembleProject({
    templatesDir,
    template: manifest.template,
    answers: targetAnswers ?? manifestTemplateVars(manifest),
    modules,
    projectRoot,
  });
  return {
    manifest,
    lock,
    modules,
    addedModules: added,
    moduleDowngrades: downgrades,
    tree,
    ownedGlobs: targetOwnedGlobs(projectRoot, templatesDir, modules, manifest.ownedGlobs),
    managedOverrides: targetManagedOverrides(
      projectRoot,
      templatesDir,
      modules,
      manifest.managedOverrides,
    ),
  };
}

export function planUpdate(
  projectRoot: string,
  templatesDir: string,
  options: PlanOptions = {},
): UpdatePlan {
  const {
    manifest,
    lock,
    modules,
    addedModules: added,
    moduleDowngrades,
    tree: newTree,
    ownedGlobs,
    managedOverrides,
  } = targetProject(projectRoot, templatesDir, options.targetAnswers);
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
  const ownedWithoutTemplate: string[] = [];
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
      if (newText !== null && disk !== null) {
        const newHash = hashContent(newText);
        const recorded = recordedTemplateHash(locked);
        if (hashContent(disk) !== newHash) {
          if (recorded && recorded !== newHash) {
            changes.push({
              path,
              tier,
              action: "review",
              note: `owned; the template changed, see podo diff ${path}`,
            });
            continue;
          }
          // The lock never records files under .podokit/, so only judge tracked files.
          if (!recorded && locked) ownedWithoutTemplate.push(path);
        }
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
        action: edited ? "keep" : "remove",
        note: edited ? REMOVED_BUT_EDITED : "removed upstream",
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

    // What PodoKit generated here last time. A file owned until now records its
    // template separately, because its outHash follows the working copy.
    const baseline = locked ? (recordedTemplateHash(locked) ?? locked.outHash) : undefined;
    if (diskHash === baseline) {
      changes.push({ path, tier, action: "update", note: "clean update" });
    } else if (newHash === baseline) {
      // The 3-way merge would have base == next and return the working copy.
      changes.push({ path, tier, action: "keep", note: EDITED_TEMPLATE_UNCHANGED });
    } else {
      changes.push({
        path,
        tier,
        action: "merge",
        note: locked
          ? "edited locally and the template changed; --apply 3-way merges it"
          : "not in the lock; --apply 3-way merges it",
      });
    }
  }

  // A configuration file the update creates, such as a missing
  // .podokit/dev.json, receives the paths after it is written.
  const created = new Set(
    changes.filter((change) => change.action === "add").map((change) => change.path),
  );
  const apiPaths = options.onlyPaths
    ? { changed: [], skipped: [] }
    : addApiPaths(projectRoot, targetApiPaths(projectRoot, templatesDir, modules).pending, {
        dryRun: true,
        read: (file) =>
          diskContent(projectRoot, file)?.toString("utf8")
          ?? (created.has(file) ? treeText(newTree, file) : null),
      });

  return {
    fromVersion: manifest.podokitVersion,
    toVersion: podokitVersion(),
    template: manifest.template,
    modules: modules.map((module) => module.name),
    addedModules: added,
    moduleDowngrades,
    changes,
    apiPaths,
    ownedWithoutTemplate,
  };
}

export interface ApplyOptions {
  /**
   * Templates for the version the project is currently on, for 3-way merges.
   * Without it, the update uses the installed templates when the project is on
   * the installed version and otherwise fetches that version's.
   */
  oldTemplatesDir?: string;
  /** Fetches the templates a published PodoKit version ships. Defaults to npm. */
  fetchTemplates?: (version: string) => PreviousTemplates;
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
  /** Modules added because the target version requires them. */
  addedModules: string[];
  written: string[];
  /** Files relocated by module update migrations. */
  moved: { from: string; to: string }[];
  removed: string[];
  /** Files 3-way merged cleanly. */
  merged: string[];
  /** Files written with conflict markers for manual resolution. */
  conflicts: string[];
  /** Owned files whose template changed; they are left as they are. */
  review: string[];
  /** Edited managed files the update left as they are, and why. */
  kept: KeptFile[];
  /** Direct API paths added to `.podokit/dev.json` and deployment profiles. */
  apiPaths: ApiPathResult;
}

export interface KeptFile {
  path: string;
  reason: string;
}

/** A template set to merge against, and how to dispose of it. */
export interface PreviousTemplates {
  dir: string;
  cleanup(): void;
}

const CLI_PACKAGE = "@podosoft/podokit";
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Install a published PodoKit CLI into a temporary directory and return its templates. */
export function publishedTemplates(version: string): PreviousTemplates {
  if (!EXACT_VERSION.test(version)) {
    throw new Error(`"${version}" is not a published ${CLI_PACKAGE} version.`);
  }
  const root = mkdtempSync(join(tmpdir(), "podokit-update-templates-"));
  const cleanup = (): void => rmSync(root, { recursive: true, force: true });
  try {
    writeFileSync(
      join(root, "package.json"),
      `${JSON.stringify(
        { name: "podokit-update-templates", private: true, devDependencies: { [CLI_PACKAGE]: version } },
        null,
        2,
      )}\n`,
    );
    execFileSync(
      "npm",
      ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false"],
      { cwd: root, stdio: "pipe" },
    );
    const packageDir = join(root, "node_modules", ...CLI_PACKAGE.split("/"));
    const installed = (JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
      version?: string;
    }).version;
    const dir = join(packageDir, "dist", "templates");
    if (installed !== version || !existsSync(dir)) {
      throw new Error(`the installed package is not ${version} or ships no templates`);
    }
    return { dir, cleanup };
  } catch (error) {
    cleanup();
    throw new Error(`Cannot install ${CLI_PACKAGE}@${version} from the npm registry: ${npmFailure(error)}`);
  }
}

/** npm's error code, such as ECONNREFUSED or ETARGET, rather than the command line. */
function npmFailure(error: unknown): string {
  const stderr = (error as { stderr?: unknown } | null)?.stderr;
  const code = String(stderr ?? "").match(/^npm (?:error|ERR!) code (\S+)/m)?.[1];
  if (code) return `npm error ${code}`;
  return error instanceof Error ? (error.message.split("\n")[0] ?? error.message) : String(error);
}

/**
 * The templates the project's edited managed files were generated from, which
 * a 3-way merge needs as its base: `--from` when given, the installed ones when
 * the project is on the installed version, and the recorded version's otherwise.
 */
function mergeBaseTemplates(
  recordedVersion: string,
  templatesDir: string,
  options: ApplyOptions,
  paths: string[],
): PreviousTemplates {
  if (options.oldTemplatesDir) return { dir: options.oldTemplatesDir, cleanup: () => {} };
  if (recordedVersion === podokitVersion()) return { dir: templatesDir, cleanup: () => {} };
  try {
    return (options.fetchTemplates ?? publishedTemplates)(recordedVersion);
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n` +
        `The 3-way merge of these edited files needs the templates of ${recordedVersion}, ` +
        `the version this project was last generated or updated with:\n${paths
          .map((path) => `  - ${path}`)
          .join("\n")}\n` +
        "Nothing was written. Check npm registry access, or pass that version's templates with --from <dir>.",
    );
  }
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

/** The project as the templates of the version it is on generated it. */
function previousTree(
  projectRoot: string,
  manifest: PodokitManifest,
  oldTemplatesDir: string,
  oldExternalModulesRoot?: string,
): VfsTree {
  const previousModules = previousExternalModules(
    projectRoot,
    oldTemplatesDir,
    manifest.modules,
    oldExternalModulesRoot,
  );
  try {
    return assembleProject({
      templatesDir: oldTemplatesDir,
      template: manifest.template,
      answers: manifestTemplateVars(manifest),
      modules: manifest.modules,
      projectRoot: previousModules.root,
    });
  } finally {
    if (previousModules.cleanup) rmSync(previousModules.root, { recursive: true, force: true });
  }
}

export interface UpstreamChange {
  path: string;
  /** Unified diff from the previous template to the new one; empty when the
   *  previous templates did not generate the file. */
  diff: string;
}

/**
 * What the template changed between the project's version and this one for
 * each owned file the plan marks for review, given the previous version's
 * templates.
 */
export function upstreamChanges(
  projectRoot: string,
  templatesDir: string,
  plan: UpdatePlan,
  oldTemplatesDir: string,
  oldExternalModulesRoot?: string,
): UpstreamChange[] {
  const review = plan.changes.filter((change) => change.action === "review");
  if (!review.length) return [];
  const target = targetProject(projectRoot, templatesDir);
  const oldTree = previousTree(projectRoot, target.manifest, oldTemplatesDir, oldExternalModulesRoot);
  return review.map((change) => {
    const before = treeText(oldTree, change.path);
    const after = treeText(target.tree, change.path) ?? "";
    return {
      path: change.path,
      diff: before === null
        ? ""
        : unifiedDiff(before, after, {
            fromLabel: `podokit-${plan.fromVersion}/${change.path}`,
            toLabel: `podokit-${plan.toVersion}/${change.path}`,
          }),
    };
  });
}

/** The 3-way merge of an edited file, or null when the previous templates do not generate it. */
function mergeEdited(
  projectRoot: string,
  path: string,
  next: string,
  oldTree: VfsTree | null,
): MergeResult | null {
  const base = oldTree ? treeText(oldTree, path) : null;
  if (base === null) return null;
  const current = readFileSync(join(projectRoot, path), "utf8");
  return threeWayMerge(base, current, next, { current: "current", next: "podokit" });
}

/**
 * Resolve each `merge` in a plan the way `--apply` would, given the previous
 * version's templates: a clean merge stays `merge`, one that would leave
 * conflict markers becomes `conflict`, and one without a merge base is `keep`.
 */
export function predictMerges(
  projectRoot: string,
  templatesDir: string,
  plan: UpdatePlan,
  oldTemplatesDir: string,
  oldExternalModulesRoot?: string,
): UpdatePlan {
  if (!plan.changes.some((change) => change.action === "merge")) return plan;
  const target = targetProject(projectRoot, templatesDir);
  const oldTree = previousTree(projectRoot, target.manifest, oldTemplatesDir, oldExternalModulesRoot);
  return {
    ...plan,
    changes: plan.changes.map((change): FileChange => {
      const next = change.action === "merge" ? treeText(target.tree, change.path) : null;
      if (next === null) return change;
      const merge = mergeEdited(projectRoot, change.path, next, oldTree);
      if (!merge) return { ...change, action: "keep", note: noMergeBase(change.path) };
      return merge.conflicts > 0
        ? { ...change, action: "conflict", note: MERGE_CONFLICTS }
        : { ...change, note: MERGES_CLEANLY };
    }),
  };
}

export interface UpdatePreview {
  plan: UpdatePlan;
  /** Why the merges in the plan were not checked; unset when they were, or when there are none. */
  mergesUnchecked?: string;
}

/**
 * The plan `podo update` shows without `--apply`. Each merge is resolved
 * against the merge base `--apply` uses (`--from`, the installed templates, or
 * the recorded version's fetched from npm), so a merge that would leave
 * conflict markers shows as a conflict. When that base cannot be had, the
 * merges stay unchecked and `mergesUnchecked` says why.
 */
export function previewUpdate(
  projectRoot: string,
  templatesDir: string,
  options: Pick<ApplyOptions, "oldTemplatesDir" | "fetchTemplates" | "oldExternalModulesRoot"> = {},
): UpdatePreview {
  const plan = planUpdate(projectRoot, templatesDir);
  const mergePaths = plan.changes.filter((change) => change.action === "merge").map((change) => change.path);
  if (!mergePaths.length) return { plan };
  let base: PreviousTemplates;
  try {
    base = mergeBaseTemplates(plan.fromVersion, templatesDir, options, mergePaths);
  } catch (error) {
    return { plan, mergesUnchecked: firstLine(error) };
  }
  try {
    return { plan: predictMerges(projectRoot, templatesDir, plan, base.dir, options.oldExternalModulesRoot) };
  } catch (error) {
    if (options.oldTemplatesDir) throw error;
    return { plan, mergesUnchecked: firstLine(error) };
  } finally {
    base.cleanup();
  }
}

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0] ?? message;
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
      if (entry.tier === "owned") entry.templateHash = hashContent(newText);
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

  // Keep a tombstone for an owned seed that the application deleted or moved,
  // including a file this update turns from managed into owned. Without the
  // entry, the next update would mistake the missing path for a newly
  // introduced seed and recreate it.
  for (const [path, entry] of Object.entries(previous.files)) {
    if (next.files[path]) continue;
    const newText = treeText(newTree, path);
    if (
      newText !== null &&
      classifyTier(path, newText, ownedGlobs, managedOverrides) === "owned"
    ) {
      next.files[path] = entry.tier === "owned"
        ? entry
        : { tier: "owned", outHash: entry.outHash, templateHash: hashContent(newText) };
    }
  }

  return next;
}

/**
 * Apply an update to the working copy. Clean updates and additions are written,
 * upstream removals deleted, user-edited files whose template did not change
 * kept, and user-edited files whose template changed 3-way merged against the
 * templates of the version the project is on, with git-style conflict markers
 * where both sides changed the same lines. Refuses before writing anything when
 * a merge needs those templates and they are unavailable. Owned files are never
 * touched. Refreshes the lockfile and stamps the new version.
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
  if (plan.moduleDowngrades.length) {
    throw new Error(
      `Refusing to downgrade external modules:\n${describeDowngrades(plan.moduleDowngrades)}\n` +
        "Install at least the recorded version (for example bun install), then run podo update again.",
    );
  }
  const { modules } = targetModules(
    projectRoot,
    templatesDir,
    manifest.modules,
    manifest.providers,
  );
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
  // Only edits the template also changed need the previous templates; an edit
  // to a file whose template did not change is kept without them.
  const mergePaths = plan.changes
    .filter((change) => change.action === "merge" && treeText(newTree, change.path) !== null)
    .map((change) => change.path);
  let oldTree: VfsTree | null = null;
  if (mergePaths.length) {
    const base = mergeBaseTemplates(manifest.podokitVersion, templatesDir, options, mergePaths);
    try {
      oldTree = previousTree(projectRoot, manifest, base.dir, options.oldExternalModulesRoot);
    } finally {
      base.cleanup();
    }
  }

  if (options.abortOnConflict) {
    const unresolved: string[] = [];
    for (const change of plan.changes) {
      if (change.action !== "merge") continue;
      const next = treeText(newTree, change.path);
      const merge = next === null ? null : mergeEdited(projectRoot, change.path, next, oldTree);
      if (!merge || merge.conflicts > 0) unresolved.push(change.path);
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
    addedModules: plan.addedModules.map((module) => module.name),
    written: [],
    moved: applyModuleMigrations(projectRoot, migrationPlan),
    removed: [],
    merged: [],
    conflicts: [],
    review: plan.changes.filter((change) => change.action === "review").map((change) => change.path),
    kept: [],
    apiPaths: { changed: [], skipped: [] },
  };

  for (const change of plan.changes) {
    const newText = treeText(newTree, change.path);
    if (change.action === "update" || change.action === "add") {
      writeFile(projectRoot, change.path, newText ?? "");
      result.written.push(change.path);
    } else if (change.action === "remove") {
      rmSync(join(projectRoot, change.path), { force: true });
      result.removed.push(change.path);
    } else if (change.action === "keep") {
      result.kept.push({ path: change.path, reason: change.note });
    } else if (change.action === "merge" && newText !== null) {
      const merge = mergeEdited(projectRoot, change.path, newText, oldTree);
      if (!merge) {
        // Nothing to merge against: never clobber the application's version.
        result.kept.push({ path: change.path, reason: noMergeBase(change.path) });
        continue;
      }
      writeFile(projectRoot, change.path, merge.merged);
      if (merge.conflicts > 0) result.conflicts.push(change.path);
      else result.merged.push(change.path);
    }
  }

  const apiPaths = options.onlyPaths ? undefined : targetApiPaths(projectRoot, templatesDir, modules);
  if (apiPaths) result.apiPaths = addApiPaths(projectRoot, apiPaths.pending);

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
    const appliedApiPaths = [
      ...new Set([
        ...(module.appliedApiPaths ?? []),
        ...(apiPaths?.declared.get(module.name) ?? []),
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
      ...(appliedApiPaths.length ? { appliedApiPaths } : {}),
    };
  });
  // The applied templates pin the current Bun release, so record it too.
  const toolchain = options.targetToolchain ?? { ...manifest.toolchain, runtimeVersion: BUN_VERSION };
  writeManifest(projectRoot, {
    ...manifest,
    answers: options.targetAnswers ?? manifestTemplateVars({ ...manifest, toolchain }),
    toolchain,
    ownedGlobs: migratedOwnedGlobs,
    managedOverrides: migratedManagedOverrides,
    modules: refreshedModules,
    podokitVersion: podokitVersion(),
  });
  return result;
}

/** One line per external module installed at an older version than recorded. */
export function describeDowngrades(downgrades: ModuleDowngrade[]): string {
  return downgrades
    .map((entry) => `  ${entry.packageName} ${entry.installed} is installed; the project applied ${entry.recorded}`)
    .join("\n");
}

/** Why an update adds a module, for the plan report. */
export function addedModuleReason(module: AddedModule): string {
  return module.capability
    ? `${module.capability} provider "${module.provider}" required by ${module.requiredBy}`
    : `required by ${module.requiredBy}`;
}

/** Count actions for a one-line summary. */
export function summarize(plan: UpdatePlan): Record<Action, number> {
  const counts: Record<Action, number> = {
    review: 0,
    update: 0,
    merge: 0,
    conflict: 0,
    keep: 0,
    add: 0,
    move: 0,
    remove: 0,
    skip: 0,
    "up-to-date": 0,
  };
  for (const change of plan.changes) counts[change.action] += 1;
  return counts;
}

export interface RetiredDeploymentKeys {
  /** The profile, relative to the project root. */
  file: string;
  keys: string[];
}

/**
 * Deployment profiles whose runtimeConfig still sets a client address key that
 * this release derives from exposure.edgeProxies. The update leaves profiles as
 * they are, since only the operator knows how many proxies sit in front of the
 * deployment, and reports them so `podo deploy` does not refuse them first.
 */
export function retiredDeploymentKeys(projectRoot: string): RetiredDeploymentKeys[] {
  const directory = join(projectRoot, ".podokit", "deploy");
  if (!existsSync(directory)) return [];
  const found: RetiredDeploymentKeys[] = [];
  for (const entry of readdirSync(directory).filter((name) => name.endsWith(".json")).sort()) {
    let profile: unknown;
    try {
      profile = JSON.parse(readFileSync(join(directory, entry), "utf8")) as unknown;
    } catch {
      continue; // podo deploy reports a profile it cannot read
    }
    const runtimeConfig = typeof profile === "object" && profile !== null
      ? (profile as { runtimeConfig?: unknown }).runtimeConfig
      : undefined;
    const keys = retiredClientAddressKeys(runtimeConfig);
    if (keys.length) found.push({ file: `.podokit/deploy/${entry}`, keys });
  }
  return found;
}

/** The report for retiredDeploymentKeys, or an empty string when there is none. */
export function describeRetiredDeploymentKeys(found: RetiredDeploymentKeys[]): string {
  if (!found.length) return "";
  return (
    "WARN deployment profiles set client address keys that PodoKit now derives from exposure.edgeProxies:\n" +
    found.map((entry) => `  ${entry.file}  runtimeConfig ${entry.keys.join(", ")}`).join("\n") +
    "\nRemove them from runtimeConfig and set exposure.edgeProxies to the number of reverse proxies in front " +
    "of the deployment (1 when omitted); podo deploy refuses the profile until then.\n"
  );
}
