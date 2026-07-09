import { readdirSync, readFileSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

/** Variables available for token substitution in template files. */
export type TemplateVars = Record<string, string>;

/** Minimal JSON object shape used for package.json merging. */
export type JsonObject = Record<string, unknown>;

/**
 * Replace `{{key}}` tokens in `content` with the matching value from `vars`.
 * Unknown tokens are left untouched so unrelated braces are preserved.
 */
export function renderTokens(content: string, vars: TemplateVars): string {
  return content.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key: string) => {
    const value = vars[key];
    return value === undefined ? match : value;
  });
}

/**
 * Map a template file name to its output name.
 * A leading `dot-` becomes `.` so files like `dot-gitignore` are shipped
 * inside npm packages (which strip real `.gitignore`) and restored on copy.
 */
export function resolveOutputName(name: string): string {
  return name.startsWith("dot-") ? `.${name.slice("dot-".length)}` : name;
}

const TEXT_FILE = /\.(json|md|ts|js|mjs|cjs|css|html|yml|yaml|txt|env|example|gitignore|svelte)$/i;

function isTextFile(name: string): boolean {
  return name.startsWith("dot-") || TEXT_FILE.test(name);
}

/** One rendered file in a virtual project tree. `text` files were token-rendered. */
export interface VfsFile {
  content: string | Buffer;
  text: boolean;
}

/**
 * A rendered project as an in-memory map of POSIX-relative path → file. Used to
 * assemble a project (or an old/new template version) without touching disk, so
 * `podo update` can diff versions before writing anything.
 */
export type VfsTree = Map<string, VfsFile>;

/**
 * Render a template directory into an in-memory {@link VfsTree}: token-render
 * text files, apply the `dot-` name convention to every path segment, and read
 * binary files verbatim. Nothing is written to disk.
 */
export function renderTemplate(srcDir: string, vars: TemplateVars, prefix = ""): VfsTree {
  const tree: VfsTree = new Map();
  for (const entry of readdirSync(srcDir)) {
    const srcPath = join(srcDir, entry);
    const relPath = prefix ? `${prefix}/${resolveOutputName(entry)}` : resolveOutputName(entry);
    if (statSync(srcPath).isDirectory()) {
      for (const [key, file] of renderTemplate(srcPath, vars, relPath)) tree.set(key, file);
    } else if (isTextFile(entry)) {
      tree.set(relPath, { content: renderTokens(readFileSync(srcPath, "utf8"), vars), text: true });
    } else {
      tree.set(relPath, { content: readFileSync(srcPath), text: false });
    }
  }
  return tree;
}

/** Write a {@link VfsTree} to `destDir`, creating parent directories as needed. */
export function writeTree(tree: VfsTree, destDir: string): void {
  for (const [relPath, file] of tree) {
    const destPath = join(destDir, relPath);
    mkdirSync(dirname(destPath), { recursive: true });
    writeFileSync(destPath, file.content);
  }
}

/**
 * Recursively copy a template directory to `destDir`, rendering tokens in text
 * files and applying the `dot-` name convention. Thin wrapper over
 * {@link renderTemplate} + {@link writeTree}.
 */
export function copyTemplate(srcDir: string, destDir: string, vars: TemplateVars): void {
  mkdirSync(destDir, { recursive: true });
  writeTree(renderTemplate(srcDir, vars), destDir);
}

/**
 * Content hash used by the generation lockfile to detect user edits. Stable
 * `sha256:<hex>` over the exact bytes PodoKit last wrote to a file.
 */
export function hashContent(content: string | Buffer): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

/**
 * Insert `text` on its own line immediately after the first line containing
 * `marker`, preserving the marker line and its indentation. No-op if `text`
 * is already present (so re-applying a module is idempotent). Throws if the
 * marker is not found.
 */
export function insertAtMarker(content: string, marker: string, text: string): string {
  if (content.includes(text)) {
    return content;
  }
  const lines = content.split("\n");
  const index = lines.findIndex((line) => line.includes(marker));
  if (index === -1) {
    throw new Error(`Marker not found: ${marker}`);
  }
  const indent = lines[index]!.match(/^\s*/)?.[0] ?? "";
  lines.splice(index, 0, `${indent}${text}`);
  return lines.join("\n");
}

/**
 * Remove the first line equal to `text` (trimmed), the inverse of
 * {@link insertAtMarker}. No-op if the line is absent (idempotent). Used by
 * `podo remove` and by update when recomputing a region from scratch.
 */
export function removeAtMarker(content: string, text: string): string {
  const needle = text.trim();
  const lines = content.split("\n");
  const index = lines.findIndex((line) => line.trim() === needle);
  if (index === -1) return content;
  lines.splice(index, 1);
  return lines.join("\n");
}

/** A fenced region located within a file. Line indices are 0-based, exclusive of the fences. */
export interface Region {
  /** Body lines between the fences (fence lines excluded). */
  lines: string[];
  /** Index of the `begin` fence line. */
  beginLine: number;
  /** Index of the `end` fence line. */
  endLine: number;
  /** Indentation of the `begin` fence, reused when rewriting the body. */
  indent: string;
}

const beginFence = (name: string): string => `// podokit:begin:${name}`;
const endFence = (name: string): string => `// podokit:end:${name}`;

/**
 * Locate the fenced region `// podokit:begin:<name>` … `// podokit:end:<name>`.
 * Returns null if either fence is missing. The region body is everything
 * between the fence lines, which update recomputes from the module set.
 */
export function extractRegion(content: string, name: string): Region | null {
  const lines = content.split("\n");
  const beginLine = lines.findIndex((line) => line.includes(beginFence(name)));
  if (beginLine === -1) return null;
  const endLine = lines.findIndex((line, i) => i > beginLine && line.includes(endFence(name)));
  if (endLine === -1) return null;
  return {
    lines: lines.slice(beginLine + 1, endLine),
    beginLine,
    endLine,
    indent: lines[beginLine]!.match(/^\s*/)?.[0] ?? "",
  };
}

/**
 * Replace the body of the fenced region `<name>` with `body`, preserving the
 * fence lines and applying the begin fence's indentation to each body line.
 * Throws if the region is not found.
 */
export function replaceRegion(content: string, name: string, body: string[]): string {
  const region = extractRegion(content, name);
  if (!region) {
    throw new Error(`Region not found: ${name}`);
  }
  const indented = body.map((line) => (line.length ? `${region.indent}${line}` : line));
  const lines = content.split("\n");
  lines.splice(region.beginLine + 1, region.endLine - region.beginLine - 1, ...indented);
  return lines.join("\n");
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep-merge `overlay` onto `base`. Objects merge recursively, arrays are
 * concatenated and de-duplicated, and scalar overlay values win. Neither input
 * is mutated. Used to combine a base package.json with module fragments.
 */
export function mergePackageJson(base: JsonObject, overlay: JsonObject): JsonObject {
  const result: JsonObject = { ...base };
  for (const [key, overlayValue] of Object.entries(overlay)) {
    const baseValue = result[key];
    if (isPlainObject(baseValue) && isPlainObject(overlayValue)) {
      result[key] = mergePackageJson(baseValue, overlayValue);
    } else if (Array.isArray(baseValue) && Array.isArray(overlayValue)) {
      result[key] = [...new Set([...baseValue, ...overlayValue])];
    } else {
      result[key] = overlayValue;
    }
  }
  return result;
}
