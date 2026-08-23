import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { assembleProject } from "./assemble";
import {
  DEFAULT_OWNED_GLOBS,
  manifestTemplateVars,
  matchGlob,
  readFilesLock,
  readManifest,
} from "./lockfile";
import { NotAProjectError } from "./inspect";
import { applyUpdate, planUpdate, type FileChange } from "./update";
import {
  BUN_VERSION,
  NODE_VERSION,
  resolveToolchain,
  toolchainTemplateVars,
  type NodePackageManager,
  type Runtime,
  type Toolchain,
} from "./toolchain";

export interface RuntimeCommand {
  command: string;
  args: string[];
}

export type RuntimeCommandRunner = (
  command: string,
  args: string[],
  cwd: string,
) => string;

export interface RuntimePlan {
  current: Toolchain;
  target: Toolchain;
  changes: FileChange[];
  commands: RuntimeCommand[];
  sourceLockfile: string;
  targetLockfile: string;
  managedPaths: string[];
  forceManagedPaths: string[];
}

export interface RuntimeSetOptions {
  packageManager?: NodePackageManager;
  runner?: RuntimeCommandRunner;
}

export interface RuntimeSetResult extends RuntimePlan {
  written: string[];
  merged: string[];
  removed: string[];
}

const LOCKFILES: Record<Toolchain["packageManager"], string> = {
  npm: "package-lock.json",
  pnpm: "pnpm-lock.yaml",
  yarn: "yarn.lock",
  bun: "bun.lock",
};

function targetAnswers(projectRoot: string, target: Toolchain): Record<string, string> {
  const manifest = readManifest(projectRoot);
  if (!manifest) throw new NotAProjectError();
  return {
    ...manifestTemplateVars(manifest),
    ...toolchainTemplateVars(target),
  };
}

function treeBytes(
  tree: ReturnType<typeof assembleProject>,
  path: string,
): Buffer | null {
  const content = tree.get(path)?.content;
  if (content === undefined) return null;
  return Buffer.isBuffer(content) ? content : Buffer.from(content);
}

function runtimeManagedPaths(
  projectRoot: string,
  templatesDir: string,
  target: Toolchain,
): { managedPaths: string[]; forceManagedPaths: string[] } {
  const manifest = readManifest(projectRoot);
  const lock = readFilesLock(projectRoot);
  if (!manifest || !lock) throw new NotAProjectError();
  const options = {
    templatesDir,
    template: manifest.template,
    modules: manifest.modules,
    projectRoot,
  };
  const currentTree = assembleProject({
    ...options,
    answers: manifestTemplateVars(manifest),
  });
  const targetTree = assembleProject({
    ...options,
    answers: targetAnswers(projectRoot, target),
  });
  const paths = new Set([...currentTree.keys(), ...targetTree.keys()]);
  const managedPaths = [...paths].filter((path) => {
    const current = treeBytes(currentTree, path);
    const next = treeBytes(targetTree, path);
    if (current === null && next === null) return false;
    if (current !== null && next !== null && current.equals(next)) return false;
    // Respect a skipped or deleted owned seed (notably `--no-ai`). Runtime-only
    // overlays have no current-tree entry, so new Bun files still qualify.
    if (current !== null && !existsSync(join(projectRoot, path)) && !lock.files[path]) {
      return false;
    }
    return true;
  });
  const forceManagedPaths = managedPaths.filter((path) =>
    DEFAULT_OWNED_GLOBS.some((glob) => matchGlob(path, glob)),
  );
  const blocked = managedPaths.filter(
    (path) => lock.files[path]?.tier === "owned" && !forceManagedPaths.includes(path),
  );
  if (blocked.length) {
    throw new Error(
      `Runtime conversion requires ejected file(s) that PodoKit no longer owns:\n${blocked
        .map((path) => `  - ${path}`)
        .join("\n")}`,
    );
  }
  return { managedPaths, forceManagedPaths };
}

function validationCommands(toolchain: Toolchain): RuntimeCommand[] {
  if (toolchain.packageManager === "bun") {
    return [
      { command: "bun", args: ["install"] },
      { command: "bun", args: ["audit", "--audit-level=high"] },
      { command: "bun", args: ["run", "build"] },
      { command: "bun", args: ["run", "lint"] },
      { command: "bun", args: ["run", "test"] },
    ];
  }
  if (toolchain.packageManager === "pnpm") {
    return [
      { command: "pnpm", args: ["install"] },
      { command: "pnpm", args: ["audit", "--audit-level", "high"] },
      { command: "pnpm", args: ["run", "build"] },
      { command: "pnpm", args: ["run", "lint"] },
      { command: "pnpm", args: ["run", "test"] },
    ];
  }
  if (toolchain.packageManager === "yarn") {
    return [
      { command: "yarn", args: ["install"] },
      { command: "yarn", args: ["audit", "--level", "high"] },
      { command: "yarn", args: ["run", "build"] },
      { command: "yarn", args: ["run", "lint"] },
      { command: "yarn", args: ["run", "test"] },
    ];
  }
  return [
    { command: "npm", args: ["install"] },
    { command: "npm", args: ["audit", "--audit-level=high"] },
    { command: "npm", args: ["run", "build"] },
    { command: "npm", args: ["run", "lint"] },
    { command: "npm", args: ["test"] },
  ];
}

export function planRuntimeSet(
  projectRoot: string,
  templatesDir: string,
  runtime: Runtime,
  packageManager?: NodePackageManager,
): RuntimePlan {
  const manifest = readManifest(projectRoot);
  if (!manifest) throw new NotAProjectError();
  const target = resolveToolchain(runtime, packageManager);
  const { managedPaths, forceManagedPaths } = runtimeManagedPaths(
    projectRoot,
    templatesDir,
    target,
  );
  const update = planUpdate(projectRoot, templatesDir, {
    targetAnswers: targetAnswers(projectRoot, target),
    forceManagedPaths,
    onlyPaths: managedPaths,
  });
  if (update.changes.some((change) => change.action === "move")) {
    throw new Error("Run podo update --apply before changing runtimes.");
  }
  return {
    current: manifest.toolchain,
    target,
    changes: update.changes,
    commands: validationCommands(target),
    sourceLockfile: LOCKFILES[manifest.toolchain.packageManager],
    targetLockfile: LOCKFILES[target.packageManager],
    managedPaths,
    forceManagedPaths,
  };
}

function defaultRunner(command: string, args: string[], cwd: string): string {
  if (args[0] === "--version") {
    return execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  execFileSync(command, args, { cwd, stdio: "inherit" });
  return "";
}

function numericVersion(value: string): number[] {
  const match = value.trim().match(/v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`Cannot parse runtime version: ${value.trim()}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function atLeast(actual: string, expected: string): boolean {
  const left = numericVersion(actual);
  const right = numericVersion(expected);
  for (let index = 0; index < 3; index += 1) {
    if (left[index]! > right[index]!) return true;
    if (left[index]! < right[index]!) return false;
  }
  return true;
}

function preflight(projectRoot: string, target: Toolchain, runner: RuntimeCommandRunner): void {
  if (target.runtime === "bun") {
    const actual = runner("bun", ["--version"], projectRoot).trim();
    if (actual !== BUN_VERSION) {
      throw new Error(`Bun ${BUN_VERSION} is required; found ${actual || "unknown"}.`);
    }
    return;
  }
  const actual = runner("node", ["--version"], projectRoot).trim();
  if (!atLeast(actual, NODE_VERSION)) {
    throw new Error(`Node.js >=${NODE_VERSION} is required; found ${actual || "unknown"}.`);
  }
  runner(target.packageManager, ["--version"], projectRoot);
}

interface Snapshot {
  path: string;
  content: Buffer | null;
}

function snapshot(projectRoot: string, paths: string[]): Snapshot[] {
  return [...new Set(paths)].map((path) => ({
    path,
    content: existsSync(join(projectRoot, path)) ? readFileSync(join(projectRoot, path)) : null,
  }));
}

function restore(projectRoot: string, snapshots: Snapshot[]): void {
  for (const entry of snapshots) {
    const target = join(projectRoot, entry.path);
    if (entry.content === null) {
      rmSync(target, { recursive: true, force: true });
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    rmSync(target, { recursive: true, force: true });
    writeFileSync(target, entry.content);
  }
}

export function applyRuntimeSet(
  projectRoot: string,
  templatesDir: string,
  runtime: Runtime,
  options: RuntimeSetOptions = {},
): RuntimeSetResult {
  const runner = options.runner ?? defaultRunner;
  const plan = planRuntimeSet(projectRoot, templatesDir, runtime, options.packageManager);
  preflight(projectRoot, plan.target, runner);

  const statePaths = [
    ...plan.changes.flatMap((change) => [change.path, ...(change.fromPath ? [change.fromPath] : [])]),
    join(".podokit", "manifest.json"),
    join(".podokit", "files.lock"),
    plan.sourceLockfile,
    plan.targetLockfile,
  ];
  const snapshots = snapshot(projectRoot, statePaths);
  const nodeModules = join(projectRoot, "node_modules");
  const backup = join(projectRoot, ".podokit", `.runtime-node_modules-${process.pid}`);
  let movedNodeModules = false;
  let installStarted = false;

  try {
    const applied = applyUpdate(projectRoot, templatesDir, {
      oldTemplatesDir: templatesDir,
      targetAnswers: targetAnswers(projectRoot, plan.target),
      targetToolchain: plan.target,
      forceManagedPaths: plan.forceManagedPaths,
      onlyPaths: plan.managedPaths,
      abortOnConflict: true,
    });
    if (existsSync(nodeModules)) {
      if (existsSync(backup)) rmSync(backup, { recursive: true, force: true });
      renameSync(nodeModules, backup);
      movedNodeModules = true;
    }
    if (plan.sourceLockfile !== plan.targetLockfile) {
      // Bun imports package-lock.json automatically, which can preserve stale
      // resolutions instead of applying the target manifest's overrides. A
      // conversion must resolve a fresh lock for the selected toolchain. Both
      // files are snapshotted above and restored if any gate fails.
      rmSync(join(projectRoot, plan.sourceLockfile), { force: true });
      rmSync(join(projectRoot, plan.targetLockfile), { force: true });
    }
    installStarted = true;
    for (const command of plan.commands) runner(command.command, command.args, projectRoot);
    if (!existsSync(join(projectRoot, plan.targetLockfile))) {
      throw new Error(`${plan.targetLockfile} was not generated.`);
    }
    if (movedNodeModules) rmSync(backup, { recursive: true, force: true });
    return {
      ...plan,
      written: applied.written,
      merged: applied.merged,
      removed: applied.removed,
    };
  } catch (error) {
    if (installStarted && existsSync(nodeModules)) {
      rmSync(nodeModules, { recursive: true, force: true });
    }
    if (movedNodeModules && existsSync(backup)) renameSync(backup, nodeModules);
    restore(projectRoot, snapshots);
    throw error;
  }
}
