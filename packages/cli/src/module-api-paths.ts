import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mergeApiPaths, parseApiPaths } from "./api-paths";
import { parseComposeProfile } from "./deploy-compose-profile";
import { parseDeploymentProfile } from "./deploy-profile";
import { isRecord } from "./deploy-schema";
import type { ManifestModule } from "./lockfile";
import { parseExactWebSocketPaths } from "./websocket-paths";

/**
 * Modules declare the direct API paths their routes need (`apiPaths` in
 * `module.manifest.json`). The development gateway configuration and the
 * deployment profiles belong to the application, so PodoKit edits only their
 * `apiPaths` lists, keeps every other key in place, and never writes a file
 * that would stop validating.
 */

export const DEV_CONFIG_FILE = ".podokit/dev.json";
const DEPLOY_DIRECTORY = ".podokit/deploy";

/** A path that a module declares. */
export interface ModuleApiPath {
  module: string;
  path: string;
}

/** A path written to, or removed from, one configuration file. */
export interface ApiPathChange extends ModuleApiPath {
  file: string;
}

/** A path left as it was in one configuration file, and why. */
export interface ApiPathSkip extends ApiPathChange {
  reason: string;
}

export interface ApiPathResult {
  changed: ApiPathChange[];
  skipped: ApiPathSkip[];
}

export interface ApiPathOptions {
  /** Report the changes without writing them. */
  dryRun?: boolean;
  /**
   * Text of a configuration file, or null when it does not exist. Defaults to
   * the file on disk; an update plan passes the file it would create.
   */
  read?: (file: string) => string | null;
}

interface ConfigDocument {
  root: Record<string, unknown>;
  /** The object holding `apiPaths`: the root of dev.json, a profile's exposure. */
  holder: Record<string, unknown>;
  current: string[];
  validate: (apiPaths: string[]) => void;
  indent: string;
  newline: string;
}

/** `.podokit/dev.json` followed by every deployment profile, project-relative. */
function configFiles(projectRoot: string): string[] {
  const directory = join(projectRoot, DEPLOY_DIRECTORY);
  const profiles = existsSync(directory)
    ? readdirSync(directory)
        .filter((entry) => entry.endsWith(".json"))
        .sort()
        .map((entry) => `${DEPLOY_DIRECTORY}/${entry}`)
    : [];
  return [DEV_CONFIG_FILE, ...profiles];
}

function readDisk(projectRoot: string, file: string): string | null {
  const path = join(projectRoot, file);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function parseDocument(file: string, text: string): ConfigDocument {
  let root: unknown;
  try {
    root = JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`Cannot read ${file}: ${(error as Error).message}`);
  }
  if (!isRecord(root)) throw new Error(`${file} must contain a JSON object.`);
  const style = {
    indent: /^[ \t]+(?=")/m.exec(text)?.[0] ?? "  ",
    newline: text.endsWith("\n") ? "\n" : "",
  };
  if (file === DEV_CONFIG_FILE) {
    return {
      root,
      holder: root,
      current: currentPaths(file, root),
      validate: (apiPaths) => {
        const webSocketPaths = parseExactWebSocketPaths(
          root.webSocketPaths ?? [],
          `${DEV_CONFIG_FILE}.webSocketPaths`,
        );
        parseApiPaths(apiPaths, `${DEV_CONFIG_FILE}.apiPaths`, webSocketPaths);
      },
      ...style,
    };
  }
  const exposure = root.exposure;
  if (!isRecord(exposure)) throw new Error(`${file} has no exposure object.`);
  const parse = root.driver === "docker-compose" ? parseComposeProfile : parseDeploymentProfile;
  return {
    root,
    holder: exposure,
    current: currentPaths(file, exposure),
    // The whole profile is checked, so driver rules such as Kubernetes
    // requiring ingress exposure for apiPaths apply too.
    validate: (apiPaths) => {
      parse({ ...root, exposure: { ...exposure, apiPaths } });
    },
    ...style,
  };
}

function currentPaths(file: string, holder: Record<string, unknown>): string[] {
  const value = holder.apiPaths ?? [];
  if (!Array.isArray(value) || value.some((path) => typeof path !== "string")) {
    throw new Error(`apiPaths in ${file} must be an array of paths.`);
  }
  return value as string[];
}

function writeDocument(projectRoot: string, file: string, document: ConfigDocument): void {
  writeFileSync(
    join(projectRoot, file),
    `${JSON.stringify(document.root, null, document.indent)}${document.newline}`,
  );
}

/**
 * Add module paths to `.podokit/dev.json` and every deployment profile. A path
 * that an entry already covers is left alone; a path that would make the file
 * invalid, for example by covering a WebSocket path or another entry, is
 * reported instead of written.
 */
export function addApiPaths(
  projectRoot: string,
  paths: readonly ModuleApiPath[],
  options: ApiPathOptions = {},
): ApiPathResult {
  const result: ApiPathResult = { changed: [], skipped: [] };
  if (paths.length === 0) return result;
  const read = options.read ?? ((file: string) => readDisk(projectRoot, file));
  for (const file of configFiles(projectRoot)) {
    const text = read(file);
    if (text === null) {
      for (const entry of paths) {
        result.skipped.push({ ...entry, file, reason: "the file does not exist" });
      }
      continue;
    }
    let document: ConfigDocument;
    try {
      document = parseDocument(file, text);
    } catch (error) {
      for (const entry of paths) {
        result.skipped.push({ ...entry, file, reason: (error as Error).message });
      }
      continue;
    }
    const merge = mergeApiPaths(
      document.current,
      paths.map((entry) => entry.path),
      document.validate,
    );
    for (const entry of paths) {
      const rejected = merge.rejected.find((item) => item.path === entry.path);
      if (rejected) result.skipped.push({ ...entry, file, reason: rejected.reason });
      else if (merge.added.includes(entry.path)) result.changed.push({ ...entry, file });
    }
    if (merge.added.length === 0 || options.dryRun) continue;
    document.holder.apiPaths = merge.paths;
    writeDocument(projectRoot, file, document);
  }
  return result;
}

/**
 * Remove exactly these paths from `.podokit/dev.json` and every deployment
 * profile. A file that would stop validating without them, such as a Compose
 * profile whose `trustedProxyCidrs` needs a direct path, is left unchanged.
 */
export function removeApiPaths(
  projectRoot: string,
  paths: readonly ModuleApiPath[],
): ApiPathResult {
  const result: ApiPathResult = { changed: [], skipped: [] };
  if (paths.length === 0) return result;
  for (const file of configFiles(projectRoot)) {
    const text = readDisk(projectRoot, file);
    if (text === null) continue;
    let document: ConfigDocument;
    try {
      document = parseDocument(file, text);
    } catch {
      continue;
    }
    const removed = paths.filter((entry) => document.current.includes(entry.path));
    if (removed.length === 0) continue;
    const next = document.current.filter((path) => !removed.some((entry) => entry.path === path));
    try {
      document.validate(next);
    } catch (error) {
      for (const entry of removed) {
        result.skipped.push({ ...entry, file, reason: (error as Error).message });
      }
      continue;
    }
    document.holder.apiPaths = next;
    writeDocument(projectRoot, file, document);
    for (const entry of removed) result.changed.push({ ...entry, file });
  }
  return result;
}

/** Paths a module declares that the project has not merged yet. */
export function pendingApiPaths(
  module: Pick<ManifestModule, "name" | "appliedApiPaths">,
  declared: readonly string[],
): ModuleApiPath[] {
  const applied = new Set(module.appliedApiPaths ?? []);
  return declared
    .filter((path) => !applied.has(path))
    .map((path) => ({ module: module.name, path }));
}

/** Indented report lines, one per changed or skipped path. */
export function describeApiPaths(result: ApiPathResult, verb: "add" | "remove"): string[] {
  const sign = verb === "add" ? "+" : "-";
  return [
    ...result.changed.map((entry) => `  ${sign} ${entry.path}  ${entry.file}  (${entry.module})`),
    ...result.skipped.map(
      (entry) =>
        `  ! ${entry.path}  ${entry.file}  (${entry.module}): not ${verb === "add" ? "added" : "removed"}; ${entry.reason}`,
    ),
  ];
}
