#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies"];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function jsonFiles(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(path, entry.name);
    if (entry.isDirectory()) return jsonFiles(entryPath);
    return entry.name === "package.json" || entry.name === "module.manifest.json" ? [entryPath] : [];
  });
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceDependencyRange(source, name, currentRange, nextRange) {
  const key = escapeRegExp(JSON.stringify(name));
  const value = escapeRegExp(JSON.stringify(currentRange));
  const pattern = new RegExp(`(${key}\\s*:\\s*)${value}`, "g");
  let replacements = 0;
  const updated = source.replace(pattern, (_match, prefix) => {
    replacements += 1;
    return `${prefix}${JSON.stringify(nextRange)}`;
  });
  if (replacements === 0) {
    throw new Error(`Could not locate ${name}@${currentRange} in template manifest source`);
  }
  return updated;
}

export function syncTemplateDependencyRanges(repoRoot) {
  const packageVersions = new Map();
  const packagesRoot = resolve(repoRoot, "packages");
  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = readJson(resolve(packagesRoot, entry.name, "package.json"));
    if (typeof manifest.name === "string" && typeof manifest.version === "string") {
      packageVersions.set(manifest.name, manifest.version);
    }
  }

  const updatedFiles = [];
  for (const path of jsonFiles(resolve(repoRoot, "templates"))) {
    let source = readFileSync(path, "utf8");
    const manifest = JSON.parse(source);
    const updates = new Map();

    for (const field of DEPENDENCY_FIELDS) {
      const dependencies = manifest[field];
      if (!isRecord(dependencies)) continue;

      for (const [name, range] of Object.entries(dependencies)) {
        const version = packageVersions.get(name);
        // Raise the minimum even while the old range still accepts the version.
        // Existing apps keep their lockfile entry until the range excludes it,
        // and templates may use APIs that only the current version provides.
        const nextRange = `^${version}`;
        if (version && typeof range === "string" && range !== nextRange) {
          updates.set(`${name}\0${range}`, { name, currentRange: range, nextRange });
        }
      }
    }

    if (updates.size > 0) {
      for (const update of updates.values()) {
        source = replaceDependencyRange(
          source,
          update.name,
          update.currentRange,
          update.nextRange,
        );
      }
      writeFileSync(path, source);
      updatedFiles.push(relative(repoRoot, path));
    }
  }

  return updatedFiles;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const repoRoot = resolve(dirname(scriptPath), "..");
  const updatedFiles = syncTemplateDependencyRanges(repoRoot);
  if (updatedFiles.length === 0) {
    console.log("Template dependency ranges already match workspace package versions.");
  } else {
    console.log(`Updated template dependency ranges in ${updatedFiles.length} file(s):`);
    for (const path of updatedFiles) console.log(`- ${path}`);
  }
}
