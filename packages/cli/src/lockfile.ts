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
export function classifyTier(relPath: string, content: string | Buffer, ownedGlobs: string[]): Tier {
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
export function computeFilesLock(projectRoot: string, ownedGlobs: string[]): FilesLock {
  const files: Record<string, FileEntry> = {};
  for (const rel of walkFiles(projectRoot).sort()) {
    const content = readFileSync(join(projectRoot, rel));
    files[rel] = { tier: classifyTier(rel, content, ownedGlobs), outHash: hashContent(content) };
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
  moduleNames: string[],
  version?: string,
  ownedGlobs?: string[],
): void {
  const manifest = readManifest(projectRoot);
  if (!manifest) return;
  const stampedWith = version ?? podokitVersion();
  const known = new Set(manifest.modules.map((m) => m.name));
  for (const name of moduleNames) {
    if (known.has(name)) continue;
    manifest.modules.push({ name, order: manifest.modules.length, addedWith: stampedWith });
    known.add(name);
  }
  if (ownedGlobs?.length) manifest.ownedGlobs = mergeOwnedGlobs(manifest.ownedGlobs, ownedGlobs);
  writeManifest(projectRoot, manifest);
  writeFilesLock(projectRoot, computeFilesLock(projectRoot, manifest.ownedGlobs));
}
