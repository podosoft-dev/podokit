import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, posix } from "node:path";
import type { VfsTree } from "@podosoft/podokit-template-engine";
import {
  readModuleManifest,
  resolveModule,
  type ModuleMigration,
} from "./add";
import type { FilesLock, ManifestModule, Tier } from "./lockfile";

export interface PendingModuleMigration {
  module: string;
  migration: ModuleMigration;
}

export interface PlannedPathMove {
  from: string;
  to: string;
  tier: Tier;
  content: Buffer;
}

export interface ModuleMigrationPlan {
  pending: PendingModuleMigration[];
  moves: PlannedPathMove[];
  conflicts: string[];
}

function treeBuffer(tree: VfsTree, path: string): Buffer | null {
  const file = tree.get(path);
  if (!file) return null;
  return Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content);
}

function assertProjectPath(path: string, label: string): void {
  if (
    !path ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    posix.normalize(path) !== path ||
    path.split("/").includes("..")
  ) {
    throw new Error(`${label} must be a normalized project-relative path: ${path}`);
  }
}

function filesUnder(projectRoot: string, path: string): string[] {
  const absolute = join(projectRoot, path);
  if (!existsSync(absolute)) return [];
  if (!statSync(absolute).isDirectory()) return [path];

  const files: string[] = [];
  const visit = (relative: string): void => {
    for (const entry of readdirSync(join(projectRoot, relative), { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(child);
      else files.push(child);
    }
  };
  visit(path);
  return files.sort();
}

function destinationFor(path: string, from: string, to: string): string {
  return path === from ? to : `${to}${path.slice(from.length)}`;
}

function occurrences(content: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while (true) {
    const index = content.indexOf(needle, offset);
    if (index === -1) return count;
    count += 1;
    offset = index + needle.length;
  }
}

function transformedContent(
  path: string,
  content: Buffer,
  pending: PendingModuleMigration[],
  conflicts: string[],
): Buffer {
  let text: string | null = null;
  for (const { module, migration } of pending) {
    for (const replacement of migration.replacements ?? []) {
      if (replacement.path !== path) continue;
      text ??= content.toString("utf8");
      const currentCount = occurrences(text, replacement.from);
      if (currentCount === replacement.expected) {
        text = text.split(replacement.from).join(replacement.to);
        continue;
      }
      const replacementCount = occurrences(text, replacement.to);
      if (currentCount === 0 && replacementCount === replacement.expected) continue;
      conflicts.push(
        `${module}:${migration.id} expected ${replacement.expected} occurrence(s) in ` +
          `${replacement.path}, found ${currentCount}`,
      );
    }
  }
  return text === null ? content : Buffer.from(text);
}

function matchesPathOrChild(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function collectPendingMigrations(
  projectRoot: string,
  templatesDir: string,
  modules: ManifestModule[],
): PendingModuleMigration[] {
  const modulesDir = join(templatesDir, "modules");
  const pending: PendingModuleMigration[] = [];
  for (const module of modules) {
    const resolved = resolveModule(module.packageName ?? module.name, modulesDir, projectRoot);
    if (!resolved) continue;
    const manifest = readModuleManifest(resolved.dir);
    const applied = new Set(module.appliedMigrations ?? []);
    for (const migration of manifest.migrations ?? []) {
      if (applied.has(migration.id)) continue;
      if (!migration.id || migration.moves.length === 0) {
        throw new Error(`Module "${module.name}" declares an invalid migration.`);
      }
      for (const move of migration.moves) {
        assertProjectPath(move.from, `${module.name}:${migration.id} move.from`);
        assertProjectPath(move.to, `${module.name}:${migration.id} move.to`);
        if (move.from === move.to) {
          throw new Error(`${module.name}:${migration.id} cannot move a path onto itself.`);
        }
      }
      for (const replacement of migration.replacements ?? []) {
        assertProjectPath(replacement.path, `${module.name}:${migration.id} replacement.path`);
        if (!replacement.from || replacement.expected < 1) {
          throw new Error(`${module.name}:${migration.id} declares an invalid text replacement.`);
        }
      }
      pending.push({ module: module.name, migration });
    }
  }
  return pending;
}

export function planModuleMigrations(
  projectRoot: string,
  targetTree: VfsTree,
  lock: FilesLock,
  pending: PendingModuleMigration[],
): ModuleMigrationPlan {
  const conflicts: string[] = [];
  const moveSources = new Set<string>();
  const moveTargets = new Set<string>();
  const candidates: Omit<PlannedPathMove, "content">[] = [];

  for (const { module, migration } of pending) {
    for (const move of migration.moves) {
      const staleTargetPaths = [...targetTree.keys()].filter((path) =>
        matchesPathOrChild(path, move.from),
      );
      if (staleTargetPaths.length) {
        conflicts.push(
          `${module}:${migration.id} target modules still provide legacy path ${move.from}; ` +
            `upgrade external modules before updating`,
        );
        continue;
      }

      for (const source of filesUnder(projectRoot, move.from)) {
        const target = destinationFor(source, move.from, move.to);
        if (moveSources.has(source)) {
          conflicts.push(`${module}:${migration.id} moves ${source} more than once`);
          continue;
        }
        if (moveTargets.has(target)) {
          conflicts.push(`${module}:${migration.id} has duplicate destination ${target}`);
          continue;
        }
        moveSources.add(source);
        moveTargets.add(target);
        candidates.push({
          from: source,
          to: target,
          tier: lock.files[source]?.tier ?? "owned",
        });
      }
    }
  }

  for (const candidate of candidates) {
    if (existsSync(join(projectRoot, candidate.to)) && !moveSources.has(candidate.to)) {
      conflicts.push(`cannot move ${candidate.from}: destination already exists at ${candidate.to}`);
    }
  }

  const moves: PlannedPathMove[] = candidates.map((candidate) => {
    const sourceContent = readFileSync(join(projectRoot, candidate.from));
    const locked = lock.files[candidate.from];
    const targetContent = treeBuffer(targetTree, candidate.to);
    const content =
      locked && locked.outHash === hashBuffer(sourceContent) && targetContent
        ? targetContent
        : transformedContent(candidate.to, sourceContent, pending, conflicts);
    return { ...candidate, content };
  });

  for (const { module, migration } of pending) {
    for (const replacement of migration.replacements ?? []) {
      if (moves.some((move) => move.to === replacement.path)) continue;
      const target = join(projectRoot, replacement.path);
      if (!existsSync(target)) continue;
      transformedContent(
        replacement.path,
        readFileSync(target),
        [{ module, migration }],
        conflicts,
      );
    }
  }

  return { pending, moves, conflicts: [...new Set(conflicts)] };
}

function hashBuffer(content: Buffer): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function pruneEmptyDirectories(projectRoot: string, relative: string): void {
  let current = relative;
  while (current && current !== "." && current !== "/") {
    try {
      rmdirSync(join(projectRoot, current));
    } catch {
      return;
    }
    current = dirname(current);
  }
}

export function applyModuleMigrations(
  projectRoot: string,
  plan: ModuleMigrationPlan,
): { from: string; to: string }[] {
  if (plan.conflicts.length) return [];
  const moved: { from: string; to: string }[] = [];
  const replacementByPath = new Map<string, Buffer>();

  for (const move of plan.moves) replacementByPath.set(move.to, move.content);
  for (const { module, migration } of plan.pending) {
    for (const replacement of migration.replacements ?? []) {
      if (replacementByPath.has(replacement.path)) continue;
      const target = join(projectRoot, replacement.path);
      if (!existsSync(target)) continue;
      replacementByPath.set(
        replacement.path,
        transformedContent(
          replacement.path,
          readFileSync(target),
          [{ module, migration }],
          [],
        ),
      );
    }
  }

  for (const move of plan.moves) {
    mkdirSync(dirname(join(projectRoot, move.to)), { recursive: true });
    writeFileSync(join(projectRoot, move.to), replacementByPath.get(move.to) ?? move.content);
    rmSync(join(projectRoot, move.from));
    pruneEmptyDirectories(projectRoot, dirname(move.from));
    moved.push({ from: move.from, to: move.to });
  }

  for (const [path, content] of replacementByPath) {
    if (plan.moves.some((move) => move.to === path)) continue;
    writeFileSync(join(projectRoot, path), content);
  }
  return moved;
}

export function migrateConfiguredPath(
  path: string,
  pending: PendingModuleMigration[],
): string {
  let migrated = path;
  for (const { migration } of pending) {
    for (const move of migration.moves) {
      if (matchesPathOrChild(migrated, move.from)) {
        migrated = destinationFor(migrated, move.from, move.to);
      }
    }
  }
  return migrated;
}
