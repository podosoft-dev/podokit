import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { hashContent } from "@podosoft/podokit-template-engine";

/**
 * The generation lockfile (`.podokit/`) records how a project was assembled so
 * `podo update` can rebuild the same inputs and detect user edits. See
 * ADR-0009 (update mechanism) and ADR-0010 (ownership model).
 */

export const LOCK_SCHEMA_VERSION = 1;

/** File ownership tier. See ADR-0010. */
export type Tier = "managed" | "assembled" | "owned";

export interface ManifestModule {
  name: string;
  /** Application order; preserves layered injection determinism. */
  order: number;
  /** PodoKit version that applied the module. */
  addedWith: string;
  /** npm package backing an external module. Absent for bundled modules. */
  packageName?: string;
  /** Installed external-module version last applied to this project. */
  moduleVersion?: string;
}

export interface ManifestModuleInput {
  name: string;
  packageName?: string;
  moduleVersion?: string;
}

export interface PodokitManifest {
  schemaVersion: number;
  podokitVersion: string;
  template: string;
  packageManager: string;
  /** Render vars / prompt answers, replayed on update (copier-style). */
  answers: Record<string, string>;
  modules: ManifestModule[];
  /** Globs whose files are user-owned and never touched by update. */
  ownedGlobs: string[];
  /** Module-supplied globs that stay managed even inside a broad owned glob. */
  managedOverrides?: string[];
}

export interface FileEntry {
  tier: Tier;
  /** Hash of the exact bytes PodoKit last wrote; user-edit detector. */
  outHash: string;
}

export interface FilesLock {
  schemaVersion: number;
  files: Record<string, FileEntry>;
}

export interface RecordModulesLockSnapshot {
  /** Lock state captured before module files are written. */
  previous: FilesLock;
  /** Previously locked paths whose working bytes still matched their baseline. */
  cleanPaths: string[];
  /** Files shipped, merged, or injected by the module application. */
  modulePaths: string[];
  /** Owned paths explicitly handed back with `podo add --adopt`. */
  adoptedPaths: string[];
}

const PODOKIT_DIR = ".podokit";
const MANIFEST_FILE = "manifest.json";
const FILES_LOCK_FILE = "files.lock";

/** Marker that flags a file as assembled from base + module injections. */
const INJECTION_MARKER = "// podokit:";

/** Directories that never belong in the lockfile (generated / vendored). */
const WALK_IGNORE = new Set([
  "node_modules",
  ".git",
  PODOKIT_DIR,
  "dist",
  "build",
  ".svelte-kit",
  ".turbo",
  "coverage",
]);

/** Default user-owned globs seeded into a new project. See ADR-0010. */
export const DEFAULT_OWNED_GLOBS = [
  "apps/web/src/routes/**",
  "apps/web/src/lib/components/ui/**",
  // Owned Nest DI extension slot — override providers here; update never touches it.
  "apps/api/src/app.extensions.ts",
  // AI agent guidance — yours to customize; update never touches it.
  "AGENTS.md",
  "CLAUDE.md",
  ".claude/**",
  ".cursor/**",
  ".github/copilot-instructions.md",
  ".mcp.json",
  // Containerized dev-environment scaffolding: users tweak ports/services, so
  // updates never overwrite these.
  "compose.dev.yaml",
  "Dockerfile.dev",
  ".dockerignore",
  ".devcontainer/**",
  ".env.docker",
  "infra/traefik/**",
  ".podokit/dev.json",
];

const TEXT_EXT = /\.(json|md|ts|tsx|js|mjs|cjs|css|html|yml|yaml|txt|env|svelte|gitignore|example)$/i;

function podokitDir(projectRoot: string): string {
  return join(projectRoot, PODOKIT_DIR);
}

export function manifestPath(projectRoot: string): string {
  return join(podokitDir(projectRoot), MANIFEST_FILE);
}

export function filesLockPath(projectRoot: string): string {
  return join(podokitDir(projectRoot), FILES_LOCK_FILE);
}

export function readManifest(projectRoot: string): PodokitManifest | null {
  const file = manifestPath(projectRoot);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as PodokitManifest) : null;
}

export function writeManifest(projectRoot: string, manifest: PodokitManifest): void {
  mkdirSync(podokitDir(projectRoot), { recursive: true });
  writeFileSync(manifestPath(projectRoot), `${JSON.stringify(manifest, null, 2)}\n`);
}

export function writeFilesLock(projectRoot: string, lock: FilesLock): void {
  mkdirSync(podokitDir(projectRoot), { recursive: true });
  writeFileSync(filesLockPath(projectRoot), `${JSON.stringify(lock, null, 2)}\n`);
}

/** Read the PodoKit CLI's own version to stamp into the manifest. */
export function podokitVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Match a POSIX relative path against a simple glob supporting `*` and `**`. */
export function matchGlob(path: string, glob: string): boolean {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  // Single pass so replacement output is never re-scanned.
  const pattern = escaped.replace(/\/\*\*$|\*\*\/|\*\*|\*/g, (token) => {
    if (token === "/**") return "(?:/.*)?"; // trailing `/**`: the dir itself or anything under it
    if (token === "**/") return "(?:.*/)?"; // `**/`: zero or more leading segments
    if (token === "**") return ".*"; // `**`: any characters
    return "[^/]*"; // `*`: within a single segment
  });
  return new RegExp(`^${pattern}$`).test(path);
}

function isTextPath(relPath: string): boolean {
  return relPath.startsWith("dot-") || TEXT_EXT.test(relPath);
}

/** Classify a file's ownership tier. See ADR-0010 priority order. */
export function classifyTier(
  relPath: string,
  content: string | Buffer,
  ownedGlobs: string[],
  managedOverrides: string[] = [],
): Tier {
  const explicitlyOwned = ownedGlobs.some(
    (glob) => !glob.includes("*") && matchGlob(relPath, glob),
  );
  if (explicitlyOwned) return "owned";
  if (managedOverrides.some((glob) => matchGlob(relPath, glob))) return "managed";
  if (ownedGlobs.some((glob) => matchGlob(relPath, glob))) return "owned";
  if (isTextPath(relPath) && content.toString("utf8").includes(INJECTION_MARKER)) return "assembled";
  return "managed";
}

/** List project files as POSIX-relative paths, skipping generated/vendored dirs. */
export function walkFiles(projectRoot: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(projectRoot, prefix))) {
    if (WALK_IGNORE.has(entry)) continue;
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(join(projectRoot, rel)).isDirectory()) {
      out.push(...walkFiles(projectRoot, rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}

/** Recompute the files.lock by hashing and classifying every project file. */
export function computeFilesLock(
  projectRoot: string,
  ownedGlobs: string[],
  managedOverrides: string[] = [],
): FilesLock {
  const files: Record<string, FileEntry> = {};
  for (const rel of walkFiles(projectRoot).sort()) {
    const content = readFileSync(join(projectRoot, rel));
    files[rel] = {
      tier: classifyTier(rel, content, ownedGlobs, managedOverrides),
      outHash: hashContent(content),
    };
  }
  return { schemaVersion: LOCK_SCHEMA_VERSION, files };
}

export function readFilesLock(projectRoot: string): FilesLock | null {
  const file = filesLockPath(projectRoot);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as FilesLock) : null;
}

export interface Drift {
  /** Managed/assembled files whose content differs from what PodoKit wrote. */
  drifted: string[];
  /** Locked files that no longer exist on disk. */
  missing: string[];
}

/**
 * Compare the current disk against the lock: report managed/assembled files the
 * user has edited (hash mismatch) or deleted. Owned files are never reported —
 * they belong to the user. Returns empty drift when there is no lock.
 */
export function computeDrift(projectRoot: string): Drift {
  const lock = readFilesLock(projectRoot);
  const drifted: string[] = [];
  const missing: string[] = [];
  if (!lock) return { drifted, missing };
  for (const [rel, entry] of Object.entries(lock.files)) {
    if (entry.tier === "owned") continue;
    const abs = join(projectRoot, rel);
    if (!existsSync(abs)) {
      missing.push(rel);
      continue;
    }
    if (hashContent(readFileSync(abs)) !== entry.outHash) drifted.push(rel);
  }
  return { drifted: drifted.sort(), missing: missing.sort() };
}

export interface InitLockOptions {
  template: string;
  packageManager: string;
  answers: Record<string, string>;
  version?: string;
  ownedGlobs?: string[];
}

/** Write the initial `.podokit/` lockfile for a freshly created project. */
export function initLockfile(projectRoot: string, options: InitLockOptions): void {
  const ownedGlobs = options.ownedGlobs ?? DEFAULT_OWNED_GLOBS;
  const manifest: PodokitManifest = {
    schemaVersion: LOCK_SCHEMA_VERSION,
    podokitVersion: options.version ?? podokitVersion(),
    template: options.template,
    packageManager: options.packageManager,
    answers: options.answers,
    modules: [],
    ownedGlobs,
    managedOverrides: [],
  };
  writeManifest(projectRoot, manifest);
  writeFilesLock(projectRoot, computeFilesLock(projectRoot, ownedGlobs));
}

/** Union two glob lists, preserving order and dropping duplicates. Used to fold
 *  module-declared and ejected owned paths into the project's `ownedGlobs`, which
 *  is the durable source of truth `computeFilesLock` re-reads on every recompute. */
export function mergeOwnedGlobs(existing: string[], add: string[]): string[] {
  const seen = new Set(existing);
  const out = [...existing];
  for (const glob of add) {
    if (seen.has(glob)) continue;
    seen.add(glob);
    out.push(glob);
  }
  return out;
}

/**
 * Record applied modules in the manifest and recompute the files.lock. Modules
 * already present are left in place (idempotent); the lock always reflects disk.
 * `ownedGlobs` a module declares are merged into the manifest so its owned paths
 * survive every future recompute. No-op on projects without a manifest.
 */
export function recordModules(
  projectRoot: string,
  moduleInputs: (string | ManifestModuleInput)[],
  version?: string,
  ownedGlobs?: string[],
  lockSnapshot?: RecordModulesLockSnapshot,
  managedOverrides?: string[],
): void {
  const manifest = readManifest(projectRoot);
  if (!manifest) return;
  const stampedWith = version ?? podokitVersion();
  const known = new Set(manifest.modules.map((m) => m.name));
  for (const input of moduleInputs) {
    const module = typeof input === "string" ? { name: input } : input;
    const existing = manifest.modules.find((entry) => entry.name === module.name);
    if (existing) {
      existing.packageName = module.packageName ?? existing.packageName;
      existing.moduleVersion = module.moduleVersion ?? existing.moduleVersion;
      continue;
    }
    manifest.modules.push({
      name: module.name,
      order: manifest.modules.length,
      addedWith: stampedWith,
      packageName: module.packageName,
      moduleVersion: module.moduleVersion,
    });
    known.add(module.name);
  }
  if (ownedGlobs?.length) manifest.ownedGlobs = mergeOwnedGlobs(manifest.ownedGlobs, ownedGlobs);
  if (managedOverrides?.length) {
    manifest.managedOverrides = mergeOwnedGlobs(manifest.managedOverrides ?? [], managedOverrides);
  }
  writeManifest(projectRoot, manifest);
  const computed = computeFilesLock(
    projectRoot,
    manifest.ownedGlobs,
    manifest.managedOverrides ?? [],
  );
  if (!lockSnapshot) {
    writeFilesLock(projectRoot, computed);
    return;
  }

  const clean = new Set(lockSnapshot.cleanPaths);
  const modulePaths = new Set(lockSnapshot.modulePaths);
  const adopted = new Set(lockSnapshot.adoptedPaths);
  const files: Record<string, FileEntry> = {};

  for (const [path, previous] of Object.entries(lockSnapshot.previous.files)) {
    const current = computed.files[path];
    if (!current) {
      // Preserve missing-file drift that existed before the add operation.
      files[path] = previous;
      continue;
    }
    if (current.tier === "owned" || adopted.has(path) || clean.has(path)) {
      files[path] = current;
    } else {
      // Adding a module must not teach the lock that pre-existing local edits
      // are generated output. Keep the old baseline so update stays safe.
      files[path] = previous;
    }
  }

  for (const path of modulePaths) {
    const current = computed.files[path];
    if (!current || files[path]) continue;
    files[path] = current;
  }

  writeFilesLock(projectRoot, { schemaVersion: LOCK_SCHEMA_VERSION, files });
}
