import { join, resolve } from "node:path";
import type { AppProxyTimeout, AppProxyTimeouts } from "./app-proxy-timeouts";

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
export const MANAGED_RUNTIME_CONFIG_KEYS = [
  "PORT",
  "BACKEND_INTERNAL_URL",
  "PROTOCOL_HEADER",
  "HOST_HEADER",
];

/**
 * Keys that decide which forwarded address web and API record. They follow from
 * the proxies in front of the deployment, so a profile states that one number and
 * PodoKit renders the four values that agree with it.
 */
export const CLIENT_ADDRESS_KEYS = ["ADDRESS_HEADER", "XFF_DEPTH", "TRUSTED_PROXY_HOPS", "TRUSTED_PROXY_HEADER"];
/** Edge proxies are counted, not configured; more than this is a typo. */
const MAX_EDGE_PROXIES = 8;

export function parseEdgeProxies(exposure: Record<string, unknown>, fallback: number): number {
  const value = exposure.edgeProxies ?? fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_EDGE_PROXIES) {
    throw new Error(`Deployment profile field "exposure.edgeProxies" must be an integer from 0 to ${MAX_EDGE_PROXIES}.`);
  }
  return value;
}

/**
 * What the web server and the API trust, given how many proxies each request to
 * the web server has passed. Behind at least one, the web server takes its origin
 * from X-Forwarded-Proto and X-Forwarded-Host and the client from the
 * X-Forwarded-For entry the outermost trusted proxy wrote (XFF_DEPTH); with none
 * it trusts no forwarded header. It forwards that one address to the API, so the
 * API always trusts one hop: the web proxy, the Compose gateway, or an Ingress
 * that trusts no proxy in front of it.
 */
export function proxyTrustConfig(
  webProxyHops: number,
  trustForwardedOrigin = webProxyHops > 0,
): Record<string, string> {
  return {
    ...(trustForwardedOrigin ? { PROTOCOL_HEADER: "x-forwarded-proto", HOST_HEADER: "x-forwarded-host" } : {}),
    ...(webProxyHops > 0 ? { ADDRESS_HEADER: "x-forwarded-for", XFF_DEPTH: String(webProxyHops) } : {}),
    TRUSTED_PROXY_HOPS: "1",
    TRUSTED_PROXY_HEADER: "x-forwarded-for",
  };
}

/**
 * Client address keys a profile may still carry from an older release: the four
 * PodoKit now derives, and the names the generated API read before them, which it
 * refuses to start with. exposure.edgeProxies replaces all of them.
 */
export const RETIRED_CLIENT_ADDRESS_KEYS = [
  ...CLIENT_ADDRESS_KEYS,
  "RATE_LIMIT_TRUSTED_PROXY_HOPS",
  "RATE_LIMIT_PROXY_HEADER",
];

/** The retired client address keys a profile's runtimeConfig sets. */
export function retiredClientAddressKeys(runtimeConfig: unknown): string[] {
  if (typeof runtimeConfig !== "object" || runtimeConfig === null || Array.isArray(runtimeConfig)) return [];
  return Object.keys(runtimeConfig).filter((key) => RETIRED_CLIENT_ADDRESS_KEYS.includes(key));
}

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
    if (RETIRED_CLIENT_ADDRESS_KEYS.includes(key)) {
      throw new Error(
        `Deployment runtimeConfig key "${key}" is derived from exposure.edgeProxies, the number of reverse ` +
          "proxies in front of the deployment; remove it and set exposure.edgeProxies instead.",
      );
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

/**
 * An application-owned PostgreSQL pool each API or worker process opens beside
 * PodoKit's own. Either `sizeKey` names the runtimeConfig key that caps it, or
 * `size` is the cap the application's code sets, such as a driver's default.
 * `extraConnections` counts connections it opens beyond that cap, such as one to
 * check a server that stopped answering.
 */
export type AppConnectionPool =
  | { sizeKey: string; extraConnections: number }
  | { size: number; extraConnections: number };

/** What the connection budget needs to know about the database, beyond its mode. */
export interface PostgresBudgetProfile {
  /** The server's max_connections; PodoKit sets it on a database it runs. */
  maxConnections?: number;
  appPools?: AppConnectionPool[];
}

/** PostgreSQL's own ceiling for max_connections. */
const MAX_POSTGRES_CONNECTIONS = 262_143;
/** Pools whose sizes the connection budget already reads. */
const PODOKIT_POOL_KEYS = ["DB_POOL_MAX", "DB_AUTH_POOL_MAX"];

export function parsePostgresBudget(
  value: Record<string, unknown>,
  field: string,
  runtimeConfig: Record<string, string>,
): PostgresBudgetProfile {
  const parsed: PostgresBudgetProfile = {};
  if (value.maxConnections !== undefined) {
    const maxConnections = value.maxConnections;
    if (
      typeof maxConnections !== "number" ||
      !Number.isInteger(maxConnections) ||
      maxConnections < 4 ||
      maxConnections > MAX_POSTGRES_CONNECTIONS
    ) {
      throw new Error(
        `Deployment profile field "${field}.maxConnections" must be an integer from 4 to ${MAX_POSTGRES_CONNECTIONS}.`,
      );
    }
    parsed.maxConnections = maxConnections;
  }
  if (value.appPools !== undefined) {
    if (!Array.isArray(value.appPools)) {
      throw new Error(`Deployment profile field "${field}.appPools" must be an array.`);
    }
    const seen = new Set<string>();
    parsed.appPools = value.appPools.map((entry, index): AppConnectionPool => {
      const entryField = `${field}.appPools[${index}]`;
      if (!isRecord(entry)) throw new Error(`Deployment profile field "${entryField}" must be an object.`);
      assertOnlyKeys(entry, ["sizeKey", "size", "extraConnections"], entryField);
      if ((entry.sizeKey === undefined) === (entry.size === undefined)) {
        throw new Error(
          `Deployment profile field "${entryField}" must set either sizeKey, the runtimeConfig key that caps the pool, ` +
            "or size, the cap the application sets itself.",
        );
      }
      const extraConnections = entry.extraConnections ?? 0;
      if (typeof extraConnections !== "number" || !Number.isInteger(extraConnections) || extraConnections < 0) {
        throw new Error(`Deployment profile field "${entryField}.extraConnections" must be a non-negative integer.`);
      }
      if (entry.size !== undefined) {
        const size = entry.size;
        if (typeof size !== "number" || !Number.isInteger(size) || size < 1 || size > MAX_POSTGRES_CONNECTIONS) {
          throw new Error(
            `Deployment profile field "${entryField}.size" must be an integer from 1 to ${MAX_POSTGRES_CONNECTIONS}.`,
          );
        }
        return { size, extraConnections };
      }
      const sizeKey = requiredString(entry, "sizeKey");
      if (!/^[A-Z][A-Z0-9_]*$/.test(sizeKey) || PODOKIT_POOL_KEYS.includes(sizeKey) || seen.has(sizeKey)) {
        throw new Error(
          `Deployment profile field "${entryField}.sizeKey" must name another pool's runtimeConfig key, once; ` +
            `${PODOKIT_POOL_KEYS.join(" and ")} are counted already.`,
        );
      }
      seen.add(sizeKey);
      if (!/^[1-9][0-9]*$/.test(runtimeConfig[sizeKey] ?? "")) {
        throw new Error(
          `Deployment profile field "${entryField}.sizeKey" names ${sizeKey}, which runtimeConfig must set to a positive integer.`,
        );
      }
      return { sizeKey, extraConnections };
    });
  }
  return parsed;
}

/** Bun closes silent connections on a 4-second tick, up to 4 seconds before their idle timeout. */
export const IDLE_TICK_SECONDS = 4;
export const MAX_IDLE_TIMEOUT_SECONDS = 255;
const DEFAULT_BACKEND_PROXY_TIMEOUT_MS = 30_000;
export const IDLE_TIMEOUT_KEYS = ["CONNECTION_IDLE_TIMEOUT", "API_IDLE_TIMEOUT"] as const;

/** The longest the /api proxy waits for response headers, and what sets it. */
export interface LongestProxyWait {
  /** Milliseconds, or null for a route without a deadline. */
  timeoutMs: number | null;
  source: string;
}

/**
 * BACKEND_PROXY_TIMEOUT_MS, or the application's longest APP_PROXY_TIMEOUTS
 * entry when that waits longer; an entry without a deadline wins outright.
 */
export function longestProxyWait(
  runtimeConfig: Record<string, string>,
  entries: AppProxyTimeout[],
): LongestProxyWait {
  const proxyTimeout = runtimeConfig.BACKEND_PROXY_TIMEOUT_MS?.trim();
  let longest: LongestProxyWait = {
    timeoutMs:
      proxyTimeout && /^\d+$/.test(proxyTimeout) ? Number(proxyTimeout) : DEFAULT_BACKEND_PROXY_TIMEOUT_MS,
    source: "BACKEND_PROXY_TIMEOUT_MS",
  };
  for (const entry of entries) {
    if (longest.timeoutMs !== null && (entry.timeoutMs === null || entry.timeoutMs > longest.timeoutMs)) {
      longest = { timeoutMs: entry.timeoutMs, source: `APP_PROXY_TIMEOUTS entry ${entry.pathPrefix}` };
    }
  }
  return longest;
}

export function describeProxyWait(wait: LongestProxyWait): string {
  return `${wait.timeoutMs === null ? "no deadline" : `${wait.timeoutMs} ms`}, ${wait.source}`;
}

/** Whether an idle timeout keeps a silent connection open for the whole wait. */
export function idleTimeoutCovers(seconds: number, wait: LongestProxyWait): boolean {
  return seconds === 0 || (wait.timeoutMs !== null && (seconds - IDLE_TICK_SECONDS) * 1000 > wait.timeoutMs);
}

/**
 * The idle timeouts of the web server (CONNECTION_IDLE_TIMEOUT) and the API
 * (API_IDLE_TIMEOUT), both run by Bun. Each is the profile's own value, or else
 * the fewest seconds that keep a silent connection open past the /api proxy's
 * longest wait: 35 for the default 30000 ms, and 0 (off) when an application
 * route has no deadline.
 */
export function idleTimeoutConfig(
  runtimeConfig: Record<string, string>,
  proxyTimeouts: AppProxyTimeouts,
): Record<string, string> {
  const config: Record<string, string> = {};
  for (const name of IDLE_TIMEOUT_KEYS) {
    const configured = runtimeConfig[name];
    if (configured !== undefined) {
      config[name] = configured;
      continue;
    }
    if ("error" in proxyTimeouts) throw new Error(proxyTimeouts.error);
    const wait = longestProxyWait(runtimeConfig, proxyTimeouts.entries);
    if (wait.timeoutMs === null) {
      config[name] = "0";
      continue;
    }
    const derived = Math.floor(wait.timeoutMs / 1000) + IDLE_TICK_SECONDS + 1;
    if (derived > MAX_IDLE_TIMEOUT_SECONDS) {
      throw new Error(
        `The /api proxy waits up to ${wait.timeoutMs} ms (${wait.source}), longer than the longest idle timeout ` +
          `(${MAX_IDLE_TIMEOUT_SECONDS} seconds); set ${name} to "0" to turn it off.`,
      );
    }
    config[name] = String(derived);
  }
  return config;
}

const DEFAULT_SHUTDOWN_TIMEOUT_SECONDS = 30;

/**
 * How long the web server drains open requests after SIGTERM: SHUTDOWN_TIMEOUT
 * from runtimeConfig, 30 unless set. The API gets the same window, and both
 * drivers size their stop timeouts from it.
 */
export function shutdownDrainSeconds(runtimeConfig: Record<string, string>): number {
  const configured = runtimeConfig.SHUTDOWN_TIMEOUT;
  return configured !== undefined && /^\d+$/.test(configured)
    ? Number(configured)
    : DEFAULT_SHUTDOWN_TIMEOUT_SECONDS;
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
