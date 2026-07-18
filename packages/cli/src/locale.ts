import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

export type LocaleDirection = "ltr" | "rtl";

export interface LocaleDefinition {
  code: string;
  name: string;
  direction: LocaleDirection;
  enabled: boolean;
}

export interface LocaleCoverage {
  definition: LocaleDefinition;
  translated: number;
  total: number;
  percent: number;
  missing: string[];
}

type JsonObject = Record<string, unknown>;

const WEB_I18N = join("apps", "web", "src", "lib", "i18n");

function definitionsDir(projectRoot: string): string {
  return join(projectRoot, WEB_I18N, "locales");
}

function catalogsDir(projectRoot: string): string {
  return join(projectRoot, WEB_I18N, "catalogs");
}

function appCatalogDir(projectRoot: string): string {
  return join(catalogsDir(projectRoot), "app");
}

export function normalizeLocaleCode(value: string): string {
  try {
    const normalized = Intl.getCanonicalLocales(value)[0];
    if (!normalized) throw new Error("missing locale");
    return normalized;
  } catch {
    throw new Error(`Invalid locale code "${value}". Use a BCP 47 language tag such as en, ko, or pt-BR.`);
  }
}

function readJson(path: string): JsonObject {
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected a JSON object: ${path}`);
  }
  return value as JsonObject;
}

function readDefinition(path: string): LocaleDefinition {
  const value = readJson(path);
  const code = typeof value.code === "string" ? normalizeLocaleCode(value.code) : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const direction = value.direction;
  const enabled = value.enabled;
  if (!code || !name || (direction !== "ltr" && direction !== "rtl") || typeof enabled !== "boolean") {
    throw new Error(`Invalid locale definition: ${path}`);
  }
  if (`${code}.json` !== basename(path)) {
    throw new Error(`Locale definition filename must match its canonical code: ${code}.json`);
  }
  return { code, name, direction, enabled };
}

export function listLocales(projectRoot: string): LocaleDefinition[] {
  const dir = definitionsDir(projectRoot);
  if (!existsSync(dir)) throw new Error("This project does not contain PodoKit JSON locale definitions.");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readDefinition(join(dir, name)))
    .sort((left, right) => left.code.localeCompare(right.code));
}

function merge(target: JsonObject, source: JsonObject): JsonObject {
  const result: JsonObject = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const previous = result[key];
    if (
      previous && typeof previous === "object" && !Array.isArray(previous) &&
      value && typeof value === "object" && !Array.isArray(value)
    ) {
      result[key] = merge(previous as JsonObject, value as JsonObject);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function composedCatalog(projectRoot: string, code: string): JsonObject {
  const root = catalogsDir(projectRoot);
  if (!existsSync(root)) return {};
  const sources = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => {
      const leftApp = left === "app" ? 1 : 0;
      const rightApp = right === "app" ? 1 : 0;
      return leftApp - rightApp || left.localeCompare(right);
    });
  let catalog: JsonObject = {};
  for (const source of sources) {
    const path = join(root, source, `${code}.json`);
    if (existsSync(path)) catalog = merge(catalog, readJson(path));
  }
  return catalog;
}

function flatten(value: unknown, prefix = "", out = new Map<string, unknown>()): Map<string, unknown> {
  if (Array.isArray(value)) {
    if (value.length === 0) out.set(prefix, value);
    for (const [index, child] of value.entries()) {
      flatten(child, `${prefix}[${index}]`, out);
    }
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as JsonObject)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out);
    }
  } else {
    out.set(prefix, value);
  }
  return out;
}

function placeholders(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "").sort();
}

export function validateLocale(projectRoot: string, rawCode: string): LocaleCoverage {
  const code = normalizeLocaleCode(rawCode);
  const definitionPath = join(definitionsDir(projectRoot), `${code}.json`);
  if (!existsSync(definitionPath)) throw new Error(`Locale ${code} has not been added.`);
  const definition = readDefinition(definitionPath);
  const base = new Map(
    [...flatten(composedCatalog(projectRoot, "en"))].filter(([, value]) => value !== ""),
  );
  const selected = flatten(composedCatalog(projectRoot, code));
  const missing: string[] = [];
  for (const [key, baseValue] of base) {
    if (!selected.has(key) || selected.get(key) === "") {
      missing.push(key);
      continue;
    }
    const selectedValue = selected.get(key);
    const baseKind = Array.isArray(baseValue) ? "array" : typeof baseValue;
    const selectedKind = Array.isArray(selectedValue) ? "array" : typeof selectedValue;
    if (baseKind !== selectedKind) throw new Error(`${code}:${key} must be ${baseKind}, received ${selectedKind}`);
    if (placeholders(baseValue).join(",") !== placeholders(selectedValue).join(",")) {
      throw new Error(`${code}:${key} must preserve placeholders ${placeholders(baseValue).join(", ")}`);
    }
  }
  const total = base.size;
  const translated = total - missing.length;
  return {
    definition,
    translated,
    total,
    percent: total === 0 ? 100 : Math.round((translated / total) * 100),
    missing,
  };
}

function defaultLocaleName(code: string): string {
  try {
    return new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function addLocale(
  projectRoot: string,
  rawCode: string,
  options: { name?: string; direction?: LocaleDirection } = {},
): LocaleDefinition {
  const code = normalizeLocaleCode(rawCode);
  const definitionPath = join(definitionsDir(projectRoot), `${code}.json`);
  const catalogPath = join(appCatalogDir(projectRoot), `${code}.json`);
  if (existsSync(definitionPath) || existsSync(catalogPath)) throw new Error(`Locale ${code} already exists.`);
  const definition: LocaleDefinition = {
    code,
    name: options.name?.trim() || defaultLocaleName(code),
    direction: options.direction ?? "ltr",
    enabled: false,
  };
  mkdirSync(definitionsDir(projectRoot), { recursive: true });
  mkdirSync(appCatalogDir(projectRoot), { recursive: true });
  writeFileSync(definitionPath, `${JSON.stringify(definition, null, 2)}\n`);
  writeFileSync(catalogPath, "{}\n");
  return definition;
}

export function setLocaleEnabled(projectRoot: string, rawCode: string, enabled: boolean): LocaleCoverage {
  const coverage = validateLocale(projectRoot, rawCode);
  if (!enabled && coverage.definition.code === "en") throw new Error("The PodoKit English fallback cannot be deactivated.");
  const definition = { ...coverage.definition, enabled };
  writeFileSync(
    join(definitionsDir(projectRoot), `${definition.code}.json`),
    `${JSON.stringify(definition, null, 2)}\n`,
  );
  return { ...coverage, definition };
}
