import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { readManifest } from "./lockfile";
import {
  DNS_LABEL,
  MigrationProfile,
  ReleaseProfile,
  VerificationProfile,
  assertOnlyKeys,
  isRecord,
  parseCommand,
  parseReleaseProfile,
  parseRequiredKeys,
  parseRuntimeConfig,
  parseVerification,
  profileDirectory,
  profilePath,
  requiredNumber,
  requiredRecord,
  requiredString,
  validateDnsLabel,
  validateDnsSubdomain,
  validateImage,
  STABLE_SEMVER_TAG_PATTERN,
} from "./deploy-schema";
import { parseExactWebSocketPaths } from "./websocket-paths";

/**
 * The Docker Compose deployment driver.
 *
 * Where the Kubernetes driver targets a cluster context and a namespace, this one
 * targets a Docker context — which may be local or `ssh://` — and a Compose project.
 * The boundary is the same in both: PodoKit operates the application, and never
 * creates the host, the reverse proxy, the TLS certificate, or the secret values.
 */

export type ComposeDependencyMode = "managed" | "external" | "disabled";

/**
 * Compose resource ceilings, in the units the Compose spec uses rather than the
 * Kubernetes ones: `cpus` is a decimal core count and `memory` a byte suffix.
 */
export interface ComposeResourceProfile {
  cpuLimit: string;
  memoryLimit: string;
}

export interface ComposeWorkloadProfile {
  replicas: number;
  resources: ComposeResourceProfile;
}

/**
 * A dependency PodoKit runs as a Compose service. Its credentials live in an env
 * file on the target host — the profile records only the path and the key names,
 * exactly as the Kubernetes driver records only Secret names and key names.
 */
export interface ComposeDependencyProfile {
  mode: ComposeDependencyMode;
  image: string;
  envFile: string;
  requiredKeys: string[];
  volume: string;
}

export interface ComposeObjectStorageProfile extends ComposeDependencyProfile {
  bucket: string;
  clientImage: string;
}

export interface ComposeEnvFileProfile {
  path: string;
  requiredKeys: string[];
}

/**
 * Development-time artifact sync. Read only by `podo deploy sync`, never rendered
 * into the Compose project — so adding it changes what that one command copies and
 * nothing about what is deployed.
 *
 * `exclude` names project-relative paths the sync must leave alone. It exists
 * because part of a build output can come from a toolchain the developer's machine
 * does not have: overwriting that part with a local build replaces real artifacts
 * with an index of artifacts that are no longer there, and the application keeps
 * serving pages while the missing files 404.
 */
export interface ComposeSyncProfile {
  exclude: string[];
}

export interface DockerComposeProfileV1 {
  schemaVersion: 1;
  driver: "docker-compose";
  target: {
    context: string;
    endpointFingerprint: string;
    project: string;
  };
  release: ReleaseProfile;
  exposure: {
    mode: "publishedPort";
    host: string;
    bindAddress: string;
    port: number;
    webSocketPaths: string[];
    trustedProxyCidrs: string[];
    gatewayImage: string;
  };
  workloads: {
    api: ComposeWorkloadProfile;
    web: ComposeWorkloadProfile;
    worker: ComposeWorkloadProfile | null;
  };
  dependencies: {
    postgres: ComposeDependencyProfile;
    redis: ComposeDependencyProfile;
    objectStorage: ComposeObjectStorageProfile;
  };
  secrets: {
    api: ComposeEnvFileProfile;
    web: ComposeEnvFileProfile | null;
    registryLogin: boolean;
  };
  migration?: MigrationProfile;
  sync?: ComposeSyncProfile;
  runtimeConfig: Record<string, string>;
  verification: VerificationProfile;
}

/** Decimal core count, e.g. "0.25" or "2". */
const CPU_VALUE = /^(?:0\.[0-9]{1,3}|[1-9][0-9]{0,2}(?:\.[0-9]{1,3})?)$/;
/** Compose byte suffix, e.g. "512m" or "2g". */
const MEMORY_VALUE = /^[1-9][0-9]*[kmg]$/;
/** A Compose project name: the same alphabet Compose itself accepts. */
const PROJECT_NAME = /^[a-z0-9][a-z0-9_-]*$/;
/** An absolute POSIX path on the target host, with no traversal or control bytes. */
const ABSOLUTE_PATH = /^\/(?:[A-Za-z0-9._-]+\/?)+$/;
const VOLUME_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

function parseTrustedProxyCidrs(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Deployment profile field "${field}" must be a string array.`);
  }

  const parsed = value.map((entry, index) => {
    if (typeof entry !== "string" || entry !== entry.trim()) {
      throw new Error(
        `Deployment profile field "${field}[${index}]" must be an IP CIDR block.`,
      );
    }
    const separator = entry.lastIndexOf("/");
    const address = entry.slice(0, separator);
    const prefixText = entry.slice(separator + 1);
    const family = isIP(address);
    if (
      separator <= 0 ||
      family === 0 ||
      !/^(?:0|[1-9][0-9]*)$/.test(prefixText) ||
      Number(prefixText) > (family === 4 ? 32 : 128)
    ) {
      throw new Error(
        `Deployment profile field "${field}[${index}]" must be an IP CIDR block.`,
      );
    }
    return entry;
  });

  if (new Set(parsed).size !== parsed.length) {
    throw new Error(`Deployment profile field "${field}" contains duplicate CIDR blocks.`);
  }
  return parsed.sort();
}

function validateCpu(value: string, field: string): void {
  if (!CPU_VALUE.test(value)) {
    throw new Error(`Deployment profile field "${field}" must be a decimal CPU count.`);
  }
}

function validateMemory(value: string, field: string): void {
  if (!MEMORY_VALUE.test(value)) {
    throw new Error(`Deployment profile field "${field}" must be a Compose memory quantity.`);
  }
}

function validateHostPath(value: string, field: string): void {
  if (!ABSOLUTE_PATH.test(value) || value.includes("..") || value.endsWith("/")) {
    throw new Error(
      `Deployment profile field "${field}" must be an absolute path on the target host.`,
    );
  }
}

function parseComposeResources(
  value: Record<string, unknown>,
  field: string,
): ComposeResourceProfile {
  assertOnlyKeys(value, ["cpuLimit", "memoryLimit"], field);
  const parsed = {
    cpuLimit: requiredString(value, "cpuLimit"),
    memoryLimit: requiredString(value, "memoryLimit"),
  };
  validateCpu(parsed.cpuLimit, `${field}.cpuLimit`);
  validateMemory(parsed.memoryLimit, `${field}.memoryLimit`);
  return parsed;
}

function parseComposeWorkload(
  value: Record<string, unknown>,
  field: string,
): ComposeWorkloadProfile {
  assertOnlyKeys(value, ["replicas", "resources"], field);
  return {
    replicas: requiredNumber(value, "replicas"),
    resources: parseComposeResources(requiredRecord(value, "resources"), `${field}.resources`),
  };
}

function parseComposeMode(value: unknown, field: string): ComposeDependencyMode {
  if (value !== "managed" && value !== "external" && value !== "disabled") {
    throw new Error(`Deployment profile field "${field}" must be managed, external, or disabled.`);
  }
  return value;
}

function parseComposeDependency(
  value: Record<string, unknown>,
  field: string,
  extraKeys: string[] = [],
): ComposeDependencyProfile {
  assertOnlyKeys(
    value,
    ["mode", "image", "envFile", "requiredKeys", "volume", ...extraKeys],
    field,
  );
  const parsed: ComposeDependencyProfile = {
    mode: parseComposeMode(value.mode, `${field}.mode`),
    image: requiredString(value, "image"),
    envFile: requiredString(value, "envFile"),
    requiredKeys: parseRequiredKeys(value.requiredKeys, `${field}.requiredKeys`),
    volume: requiredString(value, "volume"),
  };
  validateImage(parsed.image, `${field}.image`);
  validateHostPath(parsed.envFile, `${field}.envFile`);
  if (!VOLUME_NAME.test(parsed.volume)) {
    throw new Error(`Deployment profile field "${field}.volume" must be a Docker volume name.`);
  }
  return parsed;
}

/** A project-relative POSIX path: no absolute paths, no traversal, no drift upward. */
const PROJECT_RELATIVE_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

function parseSyncProfile(value: Record<string, unknown>, field: string): ComposeSyncProfile {
  assertOnlyKeys(value, ["exclude"], field);
  const exclude = value.exclude;
  if (!Array.isArray(exclude)) {
    throw new Error(`Deployment profile field "${field}.exclude" must be a string array.`);
  }
  const parsed = exclude.map((entry, index) => {
    if (
      typeof entry !== "string" ||
      !PROJECT_RELATIVE_PATH.test(entry) ||
      entry.split("/").includes("..")
    ) {
      throw new Error(
        `Deployment profile field "${field}.exclude[${index}]" must be a project-relative path.`,
      );
    }
    return entry;
  });
  if (new Set(parsed).size !== parsed.length) {
    throw new Error(`Deployment profile field "${field}.exclude" contains duplicate paths.`);
  }
  return { exclude: parsed.sort() };
}

function parseEnvFileProfile(value: unknown, field: string): ComposeEnvFileProfile {
  if (!isRecord(value)) throw new Error(`Deployment profile field "${field}" must be an object.`);
  assertOnlyKeys(value, ["path", "requiredKeys"], field);
  const parsed = {
    path: requiredString(value, "path"),
    requiredKeys: parseRequiredKeys(value.requiredKeys, `${field}.requiredKeys`),
  };
  validateHostPath(parsed.path, `${field}.path`);
  return parsed;
}

export function parseComposeProfile(value: unknown): DockerComposeProfileV1 {
  if (!isRecord(value)) throw new Error("Deployment profile must be a JSON object.");
  assertOnlyKeys(
    value,
    [
      "schemaVersion",
      "driver",
      "target",
      "release",
      "exposure",
      "workloads",
      "dependencies",
      "secrets",
      "migration",
      "sync",
      "runtimeConfig",
      "verification",
    ],
    "root",
  );
  if (value.schemaVersion !== 1) {
    throw new Error(`Unsupported deployment profile schemaVersion: ${String(value.schemaVersion)}`);
  }
  if (value.driver !== "docker-compose") {
    throw new Error(`Unsupported deployment driver: ${String(value.driver)}`);
  }

  const target = requiredRecord(value, "target");
  const exposure = requiredRecord(value, "exposure");
  const workloads = requiredRecord(value, "workloads");
  const dependencies = requiredRecord(value, "dependencies");
  const secrets = requiredRecord(value, "secrets");
  const migration = value.migration === undefined ? undefined : requiredRecord(value, "migration");
  const sync = value.sync === undefined ? undefined : requiredRecord(value, "sync");
  assertOnlyKeys(target, ["context", "endpointFingerprint", "project"], "target");
  assertOnlyKeys(
    exposure,
    [
      "mode",
      "host",
      "bindAddress",
      "port",
      "webSocketPaths",
      "trustedProxyCidrs",
      "gatewayImage",
    ],
    "exposure",
  );
  assertOnlyKeys(workloads, ["api", "web", "worker"], "workloads");
  assertOnlyKeys(dependencies, ["postgres", "redis", "objectStorage"], "dependencies");
  assertOnlyKeys(secrets, ["api", "web", "registryLogin"], "secrets");
  if (migration) assertOnlyKeys(migration, ["command"], "migration");

  const context = requiredString(target, "context");
  const endpointFingerprint = requiredString(target, "endpointFingerprint");
  if (!/^sha256:[a-f0-9]{64}$/.test(endpointFingerprint)) {
    throw new Error("Deployment target.endpointFingerprint must be a sha256 fingerprint.");
  }
  const project = requiredString(target, "project");
  if (!PROJECT_NAME.test(project) || project.length > 40) {
    throw new Error(
      "Deployment target.project must be a Compose project name of at most 40 characters.",
    );
  }

  if (exposure.mode !== "publishedPort") {
    throw new Error("Deployment exposure.mode must be publishedPort for the docker-compose driver.");
  }
  const host = requiredString(exposure, "host");
  validateDnsSubdomain(host, "exposure.host");
  const bindAddress = requiredString(exposure, "bindAddress");
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(bindAddress) || bindAddress.split(".").some((o) => Number(o) > 255)) {
    throw new Error("Deployment exposure.bindAddress must be an IPv4 address.");
  }
  const port = requiredNumber(exposure, "port");
  if (port > 65535) throw new Error("Deployment exposure.port must be a TCP port.");
  const webSocketPaths = parseExactWebSocketPaths(
    exposure.webSocketPaths ?? [],
    "exposure.webSocketPaths",
  );
  const trustedProxyCidrs = parseTrustedProxyCidrs(
    exposure.trustedProxyCidrs ?? [],
    "exposure.trustedProxyCidrs",
  );
  if (trustedProxyCidrs.length > 0 && webSocketPaths.length === 0) {
    throw new Error(
      "Deployment exposure.trustedProxyCidrs requires at least one exposure.webSocketPaths entry.",
    );
  }
  const gatewayImage =
    exposure.gatewayImage === undefined
      ? "caddy:2.10-alpine"
      : requiredString(exposure, "gatewayImage");
  validateImage(gatewayImage, "exposure.gatewayImage");

  const web = parseComposeWorkload(requiredRecord(workloads, "web"), "workloads.web");
  // Compose has no load balancer. Two replicas of the service that publishes the
  // host port means the second one cannot bind it, and the deployment fails half
  // way through the rollout with "port is already allocated". Scaling the public
  // tier is what the kubernetes-helm driver is for.
  if (web.replicas > 1) {
    throw new Error(
      "Deployment workloads.web.replicas must be 1: the web service publishes a host port, and Compose cannot share one across replicas.",
    );
  }

  const objectStorageRecord = requiredRecord(dependencies, "objectStorage");
  const objectStorage: ComposeObjectStorageProfile = {
    ...parseComposeDependency(objectStorageRecord, "dependencies.objectStorage", [
      "bucket",
      "clientImage",
    ]),
    bucket: requiredString(objectStorageRecord, "bucket"),
    clientImage: requiredString(objectStorageRecord, "clientImage"),
  };
  validateDnsLabel(objectStorage.bucket, "dependencies.objectStorage.bucket");
  validateImage(objectStorage.clientImage, "dependencies.objectStorage.clientImage");

  if (typeof secrets.registryLogin !== "boolean") {
    throw new Error("Deployment secrets.registryLogin must be a boolean.");
  }

  const profile: DockerComposeProfileV1 = {
    schemaVersion: 1,
    driver: "docker-compose",
    target: { context, endpointFingerprint, project },
    release: parseReleaseProfile(requiredRecord(value, "release")),
    exposure: {
      mode: "publishedPort",
      host,
      bindAddress,
      port,
      webSocketPaths,
      trustedProxyCidrs,
      gatewayImage,
    },
    workloads: {
      api: parseComposeWorkload(requiredRecord(workloads, "api"), "workloads.api"),
      web,
      worker:
        workloads.worker === null
          ? null
          : parseComposeWorkload(requiredRecord(workloads, "worker"), "workloads.worker"),
    },
    dependencies: {
      postgres: parseComposeDependency(
        requiredRecord(dependencies, "postgres"),
        "dependencies.postgres",
      ),
      redis: parseComposeDependency(requiredRecord(dependencies, "redis"), "dependencies.redis"),
      objectStorage,
    },
    secrets: {
      api: parseEnvFileProfile(secrets.api, "secrets.api"),
      web: secrets.web === null ? null : parseEnvFileProfile(secrets.web, "secrets.web"),
      registryLogin: secrets.registryLogin,
    },
    ...(migration
      ? { migration: { command: parseCommand(migration.command, "migration.command") } }
      : {}),
    ...(sync ? { sync: parseSyncProfile(sync, "sync") } : {}),
    runtimeConfig: parseRuntimeConfig(requiredRecord(value, "runtimeConfig")),
    verification: parseVerification(requiredRecord(value, "verification")),
  };
  return profile;
}

export interface InitializeComposeProfileOptions {
  context: string;
  endpointFingerprint: string;
  host?: string;
  /** Directory on the target host holding the env files the deployment reads. */
  secretsDirectory?: string;
}

export function buildDefaultComposeProfile(
  projectName: string,
  options: InitializeComposeProfileOptions,
): DockerComposeProfileV1 {
  const project = projectName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (!project || !DNS_LABEL.test(project)) {
    throw new Error("Project name cannot be converted to a Compose project name.");
  }
  const host = options.host ?? "app.example.com";
  const secretsDirectory = options.secretsDirectory ?? `/etc/podokit/${project}`;
  validateHostPath(secretsDirectory, "secretsDirectory");
  return {
    schemaVersion: 1,
    driver: "docker-compose",
    target: {
      context: options.context,
      endpointFingerprint: options.endpointFingerprint,
      project,
    },
    release: {
      strategy: "shared-tag",
      tagPattern: STABLE_SEMVER_TAG_PATTERN,
      apiRepository: `ghcr.io/example/${project}-api`,
      webRepository: `ghcr.io/example/${project}-web`,
    },
    exposure: {
      mode: "publishedPort",
      host,
      // Loopback by default: a reverse proxy on the same host is the expected front
      // door, and binding every interface would publish the app straight to the
      // network before TLS exists.
      bindAddress: "127.0.0.1",
      port: 8080,
      webSocketPaths: [],
      trustedProxyCidrs: [],
      gatewayImage: "caddy:2.10-alpine",
    },
    workloads: {
      api: { replicas: 2, resources: { cpuLimit: "1", memoryLimit: "1g" } },
      // One, not two: this is the service that publishes the host port.
      web: { replicas: 1, resources: { cpuLimit: "0.5", memoryLimit: "1g" } },
      worker: null,
    },
    dependencies: {
      postgres: {
        mode: "managed",
        image:
          "postgres:16.10-alpine@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297",
        envFile: `${secretsDirectory}/postgres.env`,
        requiredKeys: ["POSTGRES_DB", "POSTGRES_PASSWORD", "POSTGRES_USER"],
        volume: `${project}-postgres`,
      },
      redis: {
        mode: "disabled",
        image: "redis:7.4.5-alpine",
        envFile: `${secretsDirectory}/redis.env`,
        requiredKeys: ["REDIS_PASSWORD"],
        volume: `${project}-redis`,
      },
      objectStorage: {
        mode: "disabled",
        image: "quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z",
        clientImage: "quay.io/minio/mc:RELEASE.2025-08-13T08-35-41Z",
        envFile: `${secretsDirectory}/object-storage.env`,
        requiredKeys: [
          "MINIO_ROOT_PASSWORD",
          "MINIO_ROOT_USER",
          "S3_ACCESS_KEY_ID",
          "S3_SECRET_ACCESS_KEY",
        ],
        volume: `${project}-object-storage`,
        bucket: "app",
      },
    },
    secrets: {
      api: { path: `${secretsDirectory}/api.env`, requiredKeys: [] },
      web: null,
      registryLogin: true,
    },
    runtimeConfig: {
      NODE_ENV: "production",
      CORS_ORIGIN: `https://${host}`,
      ADDRESS_HEADER: "x-forwarded-for",
      XFF_DEPTH: "1",
    },
    verification: {
      baseUrl: `https://${host}`,
      checks: [
        { path: "/", expectedStatus: 200 },
        { path: "/api/health", expectedStatus: 200, expectedJson: { status: "ok" } },
        { path: "/api/health/ready", expectedStatus: 200, expectedJson: { status: "ready" } },
      ],
    },
  };
}

export interface ComposeProfileSummary {
  name: string;
  path: string;
  profile: DockerComposeProfileV1;
}

export function initializeComposeProfile(
  projectRoot: string,
  name: string,
  options: InitializeComposeProfileOptions,
): ComposeProfileSummary {
  const manifest = readManifest(projectRoot);
  if (!manifest) throw new Error("Not a PodoKit project: .podokit/manifest.json is missing.");
  const projectName = manifest.answers.projectName;
  if (!projectName) throw new Error("PodoKit manifest is missing answers.projectName.");
  const path = profilePath(projectRoot, name);
  if (existsSync(path)) throw new Error(`Deployment profile "${name}" already exists.`);

  const draft = buildDefaultComposeProfile(projectName, options);
  const modules = new Set(manifest.modules.map((module) => module.name));
  const usesRedis = [...modules].some((module) =>
    ["redis", "bullmq", "job-progress", "rate-limit", "sse"].includes(module),
  );
  draft.dependencies.redis.mode = usesRedis ? "managed" : "disabled";
  draft.dependencies.objectStorage.mode = modules.has("object-storage-s3")
    ? "managed"
    : "disabled";
  if (modules.has("bullmq")) {
    draft.workloads.worker = { replicas: 1, resources: { cpuLimit: "0.5", memoryLimit: "512m" } };
  }
  const usesAuth = modules.has("auth");
  draft.secrets.api.requiredKeys = [
    ...(usesAuth ? ["BETTER_AUTH_SECRET"] : []),
    ...(modules.has("api-key-auth") ? ["API_KEYS"] : []),
  ].sort();
  const host = draft.exposure.host;
  draft.runtimeConfig = {
    ...draft.runtimeConfig,
    ...(usesAuth ? { BETTER_AUTH_URL: `https://${host}` } : {}),
    ...(modules.has("sse") && usesRedis ? { SSE_TRANSPORT: "redis" } : {}),
    ...(modules.has("rate-limit")
      ? {
          RATE_LIMIT_TTL: "60",
          RATE_LIMIT_KEY_PREFIX: "podokit:rate-limit",
          RATE_LIMIT_MAX: "300",
          RATE_LIMIT_AUTH_TTL: "60",
          RATE_LIMIT_AUTH_MAX: "20",
          RATE_LIMIT_RUNTIME_MAX: "1000",
          RATE_LIMIT_TRUSTED_PROXY_HOPS: "1",
          RATE_LIMIT_PROXY_HEADER: "x-forwarded-for",
          RATE_LIMIT_STORAGE_TIMEOUT_MS: "1000",
          RATE_LIMIT_UNAVAILABLE_RETRY_AFTER: "1",
        }
      : {}),
  };

  const validated = parseComposeProfile(draft);
  mkdirSync(profileDirectory(projectRoot), { recursive: true });
  writeFileSync(path, `${JSON.stringify(validated, null, 2)}\n`, { flag: "wx" });
  return { name, path, profile: validated };
}

export function composeProfileDigest(profile: DockerComposeProfileV1): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(profile)).digest("hex")}`;
}
