import { join, resolve } from "node:path";

/**
 * Validation primitives shared by every deployment driver.
 *
 * A driver profile decides its own target, exposure, and dependency shape, but the
 * pieces that describe *what is being released* — image repositories, the stable tag
 * pattern, the migration command, non-secret runtime configuration, and the public
 * verification contract — mean the same thing everywhere and are parsed here once.
 */

export interface VerificationCheckProfile {
  path: string;
  expectedStatus: number;
  expectedJson?: Record<string, string | number | boolean | null>;
}

export interface VerificationProfile {
  baseUrl: string;
  checks: VerificationCheckProfile[];
}

export interface MigrationProfile {
  command: string[];
}

export interface ReleaseProfile {
  strategy: "shared-tag";
  tagPattern: string;
  apiRepository: string;
  webRepository: string;
}

export const PROFILE_NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
export const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IMAGE_NAME =
  /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[1-9][0-9]{0,4})?\/)?(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const IMAGE_TAG = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
export const SENSITIVE_KEY =
  /(password|passphrase|secret|token|private.?key|credential|access.?key|api.?keys?|signing.?key|encryption.?key)/i;
export const STABLE_SEMVER_TAG_PATTERN =
  "^v(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$";

/** Keys PodoKit derives itself, so a profile may not set them. */
export const MANAGED_RUNTIME_CONFIG_KEYS = ["PORT", "BACKEND_INTERNAL_URL"];

export function containsUrlCredentials(value: string): boolean {
  if (!value.includes("://")) return false;
  try {
    const parsed = new URL(value);
    return parsed.username !== "" || parsed.password !== "";
  } catch {
    return false;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: string[],
  field: string,
): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) {
    throw new Error(
      `Deployment profile field "${field}" contains unknown key(s): ${unexpected.join(", ")}.`,
    );
  }
}

export function requiredRecord(
  parent: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = parent[key];
  if (!isRecord(value)) throw new Error(`Deployment profile field "${key}" must be an object.`);
  return value;
}

export function requiredString(parent: Record<string, unknown>, key: string): string {
  const value = parent[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Deployment profile field "${key}" must be a non-empty string.`);
  }
  return value;
}

export function optionalString(parent: Record<string, unknown>, key: string): string | null {
  const value = parent[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Deployment profile field "${key}" must be a string or null.`);
  }
  return value;
}

export function requiredNumber(parent: Record<string, unknown>, key: string): number {
  const value = parent[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`Deployment profile field "${key}" must be a positive integer.`);
  }
  return value;
}

export function parseRequiredKeys(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Deployment profile field "${field}" must be a string array.`);
  }
  const keys = value.map((entry) => {
    if (typeof entry !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(entry)) {
      throw new Error(`Deployment profile field "${field}" contains an invalid environment key.`);
    }
    return entry;
  });
  if (new Set(keys).size !== keys.length) {
    throw new Error(`Deployment profile field "${field}" contains duplicate keys.`);
  }
  return keys.sort();
}

export function parseCommand(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Deployment profile field "${field}" must be a non-empty string array.`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new Error(`Deployment profile field "${field}[${index}]" must be a non-empty string.`);
    }
    if (/[\u0000-\u001f\u007f]/.test(entry)) {
      throw new Error(
        `Deployment profile field "${field}[${index}]" must not contain control characters.`,
      );
    }
    return entry;
  });
}

export function validateDnsLabel(value: string, field: string): void {
  if (!DNS_LABEL.test(value)) {
    throw new Error(`Deployment profile field "${field}" must be a Kubernetes DNS label.`);
  }
}

export function validateDnsSubdomain(value: string, field: string): void {
  if (value.length > 253 || !value.split(".").every((label) => DNS_LABEL.test(label))) {
    throw new Error(`Deployment profile field "${field}" must be a Kubernetes DNS subdomain.`);
  }
}

export function parseImageReference(value: string): {
  name: string;
  tag: string | null;
  digest: string | null;
} | null {
  if (value.length > 512 || value.includes("://") || /[\s\u0000-\u001f\u007f]/.test(value)) {
    return null;
  }
  const at = value.indexOf("@");
  if (at !== -1 && at !== value.lastIndexOf("@")) return null;
  const digest = at === -1 ? null : value.slice(at + 1);
  const tagged = at === -1 ? value : value.slice(0, at);
  const lastSlash = tagged.lastIndexOf("/");
  const lastColon = tagged.lastIndexOf(":");
  const hasTag = lastColon > lastSlash;
  const name = hasTag ? tagged.slice(0, lastColon) : tagged;
  const tag = hasTag ? tagged.slice(lastColon + 1) : null;
  if (
    !IMAGE_NAME.test(name) ||
    (tag !== null && !IMAGE_TAG.test(tag)) ||
    (digest !== null && !/^sha256:[a-f0-9]{64}$/.test(digest))
  ) {
    return null;
  }
  return { name, tag, digest };
}

export function validateImage(value: string, field: string): void {
  const parsed = parseImageReference(value);
  if (!parsed || parsed.tag === "latest" || (!parsed.tag && !parsed.digest)) {
    throw new Error(
      `Deployment profile field "${field}" must use an explicit non-latest image tag or digest.`,
    );
  }
}

export function validateImageRepository(value: string, field: string): void {
  const parsed = parseImageReference(value);
  if (!parsed || parsed.tag || parsed.digest) {
    throw new Error(
      `Deployment profile field "${field}" must be an image repository without a tag or digest.`,
    );
  }
}

export function parseReleaseProfile(release: Record<string, unknown>): ReleaseProfile {
  assertOnlyKeys(release, ["strategy", "tagPattern", "apiRepository", "webRepository"], "release");
  const tagPattern = requiredString(release, "tagPattern");
  if (tagPattern !== STABLE_SEMVER_TAG_PATTERN) {
    throw new Error("Deployment release.tagPattern must require stable vMAJOR.MINOR.PATCH tags.");
  }
  if (release.strategy !== "shared-tag") {
    throw new Error("Deployment release.strategy must be shared-tag.");
  }
  const apiRepository = requiredString(release, "apiRepository");
  const webRepository = requiredString(release, "webRepository");
  validateImageRepository(apiRepository, "release.apiRepository");
  validateImageRepository(webRepository, "release.webRepository");
  return { strategy: "shared-tag", tagPattern, apiRepository, webRepository };
}

export function parseRuntimeConfig(runtimeConfig: Record<string, unknown>): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const [key, entry] of Object.entries(runtimeConfig)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      throw new Error(
        `Deployment runtimeConfig key "${key}" must be an uppercase environment name.`,
      );
    }
    if (SENSITIVE_KEY.test(key)) {
      throw new Error(`Deployment runtimeConfig key "${key}" may contain a secret; use a secret store.`);
    }
    if (MANAGED_RUNTIME_CONFIG_KEYS.includes(key)) {
      throw new Error(`Deployment runtimeConfig key "${key}" is managed by PodoKit.`);
    }
    if (typeof entry !== "string") {
      throw new Error(`Deployment runtimeConfig value "${key}" must be a string.`);
    }
    if (containsUrlCredentials(entry)) {
      throw new Error(
        `Deployment runtimeConfig value "${key}" contains URL credentials; use a secret store.`,
      );
    }
    parsed[key] = entry;
  }
  return parsed;
}

export function validateHttpsOrigin(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Deployment verification baseUrl "${value}" is invalid.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(
      "Deployment verification baseUrl must not contain URL credentials; use a credential-free HTTPS origin.",
    );
  }
  if (parsed.protocol !== "https:" || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("Deployment verification baseUrl must be an HTTPS origin without a path.");
  }
}

export function parseVerification(verification: Record<string, unknown>): VerificationProfile {
  assertOnlyKeys(verification, ["baseUrl", "checks"], "verification");
  const baseUrl = requiredString(verification, "baseUrl");
  validateHttpsOrigin(baseUrl);
  const baseOrigin = new URL(baseUrl).origin;
  const checksValue = verification.checks;
  if (!Array.isArray(checksValue) || checksValue.length === 0) {
    throw new Error("Deployment verification.checks must be a non-empty array.");
  }
  const checks = checksValue.map((entry, index): VerificationCheckProfile => {
    if (!isRecord(entry)) {
      throw new Error(`Deployment verification.checks[${index}] must be an object.`);
    }
    assertOnlyKeys(
      entry,
      ["path", "expectedStatus", "expectedJson"],
      `verification.checks[${index}]`,
    );
    const path = requiredString(entry, "path");
    if (
      !path.startsWith("/") ||
      path.startsWith("//") ||
      path.includes("\\") ||
      /[\u0000-\u001f\u007f]/.test(path) ||
      new URL(path, baseUrl).origin !== baseOrigin
    ) {
      throw new Error("Every deployment verification path must be an absolute URL path.");
    }
    const expectedStatus = requiredNumber(entry, "expectedStatus");
    if (expectedStatus < 100 || expectedStatus > 599) {
      throw new Error("Deployment verification expectedStatus must be an HTTP status.");
    }
    const expectedJsonValue = entry.expectedJson;
    let expectedJson: VerificationCheckProfile["expectedJson"];
    if (expectedJsonValue !== undefined) {
      if (!isRecord(expectedJsonValue)) {
        throw new Error("Deployment verification expectedJson must be an object.");
      }
      expectedJson = {};
      for (const [key, value] of Object.entries(expectedJsonValue)) {
        if (
          value !== null &&
          typeof value !== "string" &&
          typeof value !== "number" &&
          typeof value !== "boolean"
        ) {
          throw new Error("Deployment verification expectedJson values must be scalar.");
        }
        expectedJson[key] = value;
      }
    }
    return { path, expectedStatus, ...(expectedJson ? { expectedJson } : {}) };
  });
  return { baseUrl, checks };
}

export function profileDirectory(projectRoot: string): string {
  return join(resolve(projectRoot), ".podokit", "deploy");
}

export function profilePath(projectRoot: string, name: string): string {
  if (!PROFILE_NAME.test(name)) {
    throw new Error(`Invalid deployment profile name "${name}".`);
  }
  return join(profileDirectory(projectRoot), `${name}.json`);
}
