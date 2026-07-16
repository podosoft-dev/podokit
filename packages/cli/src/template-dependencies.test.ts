import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

type JsonObject = Record<string, unknown>;

const REPO_ROOT = resolve(process.cwd(), "..", "..");
const TEMPLATES_ROOT = resolve(REPO_ROOT, "templates");
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies"] as const;

function readJson(path: string): JsonObject {
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}

function jsonFiles(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(path, entry.name);
    if (entry.isDirectory()) return jsonFiles(entryPath);
    return entry.name === "package.json" || entry.name === "module.manifest.json" ? [entryPath] : [];
  });
}

function dependencyEntries(value: unknown): Array<[string, string]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  return Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string");
}

function supportsVersion(range: string, version: string): boolean {
  const rangeMatch = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
  const versionMatch = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!rangeMatch || !versionMatch) return false;

  const minimum = rangeMatch.slice(1).map(Number);
  const current = versionMatch.slice(1).map(Number);
  const [minimumMajor, minimumMinor, minimumPatch] = minimum;
  const [currentMajor, currentMinor, currentPatch] = current;
  if (
    minimumMajor === undefined || minimumMinor === undefined || minimumPatch === undefined ||
    currentMajor === undefined || currentMinor === undefined || currentPatch === undefined
  ) return false;
  if (currentMajor !== minimumMajor) return false;
  if (currentMajor > 0) {
    return currentMinor > minimumMinor || (currentMinor === minimumMinor && currentPatch >= minimumPatch);
  }
  if (currentMinor !== minimumMinor) return false;
  return currentMinor > 0 ? currentPatch >= minimumPatch : currentPatch === minimumPatch;
}

describe("template PodoKit dependency ranges", () => {
  it("accepts the current workspace package versions", () => {
    const workspaceVersions = new Map<string, string>();
    for (const packageDir of readdirSync(resolve(REPO_ROOT, "packages"), { withFileTypes: true })) {
      if (!packageDir.isDirectory()) continue;
      const manifest = readJson(resolve(REPO_ROOT, "packages", packageDir.name, "package.json"));
      if (typeof manifest.name === "string" && typeof manifest.version === "string") {
        workspaceVersions.set(manifest.name, manifest.version);
      }
    }

    const incompatible: string[] = [];
    for (const path of jsonFiles(TEMPLATES_ROOT)) {
      const manifest = readJson(path);
      for (const field of DEPENDENCY_FIELDS) {
        for (const [name, range] of dependencyEntries(manifest[field])) {
          const version = workspaceVersions.get(name);
          if (version && !supportsVersion(range, version)) {
            incompatible.push(`${relative(REPO_ROOT, path)}: ${name}@${range} does not accept ${version}`);
          }
        }
      }
    }

    expect(incompatible).toEqual([]);
  });
});
