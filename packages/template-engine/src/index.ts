import { readdirSync, readFileSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

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

/**
 * Recursively copy a template directory to `destDir`, rendering tokens in
 * text files and applying the `dot-` name convention. Directories are created
 * as needed. Binary files are copied verbatim.
 */
export function copyTemplate(srcDir: string, destDir: string, vars: TemplateVars): void {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    const srcPath = join(srcDir, entry);
    const outName = resolveOutputName(entry);
    const destPath = join(destDir, outName);
    if (statSync(srcPath).isDirectory()) {
      copyTemplate(srcPath, destPath, vars);
      continue;
    }
    if (isTextFile(entry)) {
      const rendered = renderTokens(readFileSync(srcPath, "utf8"), vars);
      writeFileSync(destPath, rendered);
    } else {
      writeFileSync(destPath, readFileSync(srcPath));
    }
  }
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
