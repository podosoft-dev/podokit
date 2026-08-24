import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readManifest } from "./lockfile";
import {
  MigrationProfile,
  VerificationCheckProfile,
  assertOnlyKeys,
  isRecord,
  optionalString,
  parseCommand,
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
  validateImageRepository,
  STABLE_SEMVER_TAG_PATTERN,
} from "./deploy-schema";

export { profileDirectory, profilePath } from "./deploy-schema";
export type { MigrationProfile, VerificationCheckProfile } from "./deploy-schema";

export type DependencyMode = "inCluster" | "external" | "disabled";

export interface ResourceProfile {
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
}

export interface WorkloadProfile {
  replicas: number;
  resources: ResourceProfile;
}

export interface StatefulDependencyProfile {
  mode: DependencyMode;
  image: string;
  secretName: string;
  storageClassName: string;
  storageSize: string;
}

export type RedisDependencyProfile = StatefulDependencyProfile;

export interface ObjectStorageDependencyProfile extends StatefulDependencyProfile {
  bucket: string;
  clientImage: string;
}

export interface NamedSecretProfile {
  name: string;
  requiredKeys: string[];
}

export interface DeployProfileV1 {
  schemaVersion: 1;
  driver: "kubernetes-helm";
  target: {
    context: string;
    clusterFingerprint: string;
    namespace: string;
    release: string;
    createNamespace: false;
  };
  release: {
    strategy: "shared-tag";
    tagPattern: string;
    apiRepository: string;
    webRepository: string;
  };
  exposure: {
    mode: "ingress" | "nodePort";
    host: string;
    ingressClassName: string;
    tlsSecretName: string | null;
  };
  workloads: {
    api: WorkloadProfile;
    web: WorkloadProfile;
    worker: WorkloadProfile | null;
  };
  dependencies: {
    postgres: StatefulDependencyProfile;
    redis: RedisDependencyProfile;
    objectStorage: ObjectStorageDependencyProfile;
  };
  secrets: {
    api: NamedSecretProfile;
    web: NamedSecretProfile | null;
    imagePull: string;
  };
  migration?: MigrationProfile;
  runtimeConfig: Record<string, string>;
  verification: {
    baseUrl: string;
    checks: VerificationCheckProfile[];
  };
}

export interface DeploymentProfileSummary {
  name: string;
  path: string;
  profile: DeployProfileV1;
}

const RESOURCE_VALUE = /^[1-9][0-9]*(?:m|Mi|Gi)?$/;
const STORAGE_VALUE = /^[1-9][0-9]*(?:Mi|Gi|Ti)$/;

function parseNamedSecret(value: unknown, field: string): NamedSecretProfile {
  if (!isRecord(value)) {
    throw new Error(`Deployment profile field "${field}" must be an object.`);
  }
  assertOnlyKeys(value, ["name", "requiredKeys"], field);
  const parsed = {
    name: requiredString(value, "name"),
    requiredKeys: parseRequiredKeys(value.requiredKeys, `${field}.requiredKeys`),
  };
  validateDnsLabel(parsed.name, `${field}.name`);
  return parsed;
}

function validateResource(value: string, field: string): void {
  if (!RESOURCE_VALUE.test(value)) {
    throw new Error(`Deployment profile field "${field}" is not a supported resource quantity.`);
  }
}

function validateStorage(value: string, field: string): void {
  if (!STORAGE_VALUE.test(value)) {
    throw new Error(`Deployment profile field "${field}" is not a supported storage quantity.`);
  }
}

function parseResources(value: Record<string, unknown>, field: string): ResourceProfile {
  assertOnlyKeys(
    value,
    ["cpuRequest", "cpuLimit", "memoryRequest", "memoryLimit"],
    field,
  );
  const parsed = {
    cpuRequest: requiredString(value, "cpuRequest"),
    cpuLimit: requiredString(value, "cpuLimit"),
    memoryRequest: requiredString(value, "memoryRequest"),
    memoryLimit: requiredString(value, "memoryLimit"),
  };
  for (const [key, quantity] of Object.entries(parsed)) validateResource(quantity, `${field}.${key}`);
  return parsed;
}

function parseWorkload(value: Record<string, unknown>, field: string): WorkloadProfile {
  assertOnlyKeys(value, ["replicas", "resources"], field);
  return {
    replicas: requiredNumber(value, "replicas"),
    resources: parseResources(requiredRecord(value, "resources"), `${field}.resources`),
  };
}

function parseMode(value: unknown, field: string): DependencyMode {
  if (value !== "inCluster" && value !== "external" && value !== "disabled") {
    throw new Error(`Deployment profile field "${field}" must be inCluster, external, or disabled.`);
  }
  return value;
}

function parseStatefulDependency(
  value: Record<string, unknown>,
  field: string,
  extraKeys: string[] = [],
): StatefulDependencyProfile {
  assertOnlyKeys(
    value,
    ["mode", "image", "secretName", "storageClassName", "storageSize", ...extraKeys],
    field,
  );
  const parsed: StatefulDependencyProfile = {
    mode: parseMode(value.mode, `${field}.mode`),
    image: requiredString(value, "image"),
    secretName: requiredString(value, "secretName"),
    storageClassName:
      typeof value.storageClassName === "string" ? value.storageClassName : "",
    storageSize: requiredString(value, "storageSize"),
  };
  validateImage(parsed.image, `${field}.image`);
  validateDnsLabel(parsed.secretName, `${field}.secretName`);
  validateStorage(parsed.storageSize, `${field}.storageSize`);
  if (parsed.storageClassName && parsed.storageClassName.length > 253) {
    throw new Error(`Deployment profile field "${field}.storageClassName" is too long.`);
  }
  return parsed;
}

function parseRedisDependency(
  value: Record<string, unknown>,
  field: string,
): RedisDependencyProfile {
  return parseStatefulDependency(value, field);
}

function parseProfile(value: unknown): DeployProfileV1 {
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
      "runtimeConfig",
      "verification",
    ],
    "root",
  );
  if (value.schemaVersion !== 1) {
    throw new Error(`Unsupported deployment profile schemaVersion: ${String(value.schemaVersion)}`);
  }
  if (value.driver !== "kubernetes-helm") {
    throw new Error(`Unsupported deployment driver: ${String(value.driver)}`);
  }

  const target = requiredRecord(value, "target");
  const release = requiredRecord(value, "release");
  const exposure = requiredRecord(value, "exposure");
  const workloads = requiredRecord(value, "workloads");
  const dependencies = requiredRecord(value, "dependencies");
  const secrets = requiredRecord(value, "secrets");
  const migration =
    value.migration === undefined ? undefined : requiredRecord(value, "migration");
  const verification = requiredRecord(value, "verification");
  const runtimeConfig = requiredRecord(value, "runtimeConfig");
  assertOnlyKeys(
    target,
    ["context", "clusterFingerprint", "namespace", "release", "createNamespace"],
    "target",
  );
  assertOnlyKeys(
    release,
    ["strategy", "tagPattern", "apiRepository", "webRepository"],
    "release",
  );
  assertOnlyKeys(
    exposure,
    ["mode", "host", "ingressClassName", "tlsSecretName"],
    "exposure",
  );
  assertOnlyKeys(workloads, ["api", "web", "worker"], "workloads");
  assertOnlyKeys(dependencies, ["postgres", "redis", "objectStorage"], "dependencies");
  assertOnlyKeys(secrets, ["api", "web", "imagePull"], "secrets");
  if (migration) assertOnlyKeys(migration, ["command"], "migration");
  assertOnlyKeys(verification, ["baseUrl", "checks"], "verification");

  const context = requiredString(target, "context");
  const clusterFingerprint = requiredString(target, "clusterFingerprint");
  if (!/^sha256:[a-f0-9]{64}$/.test(clusterFingerprint)) {
    throw new Error("Deployment target.clusterFingerprint must be a sha256 fingerprint.");
  }
  const namespace = requiredString(target, "namespace");
  const releaseName = requiredString(target, "release");
  validateDnsLabel(namespace, "target.namespace");
  validateDnsLabel(releaseName, "target.release");
  if (releaseName.length > 40) {
    throw new Error("Deployment target.release must be at most 40 characters.");
  }
  if (target.createNamespace !== false) {
    throw new Error("Deployment target.createNamespace must be false in schema version 1.");
  }

  const tagPattern = requiredString(release, "tagPattern");
  if (tagPattern !== STABLE_SEMVER_TAG_PATTERN) {
    throw new Error(
      "Deployment release.tagPattern must require stable vMAJOR.MINOR.PATCH tags.",
    );
  }
  if (release.strategy !== "shared-tag") {
    throw new Error("Deployment release.strategy must be shared-tag.");
  }
  const apiRepository = requiredString(release, "apiRepository");
  const webRepository = requiredString(release, "webRepository");
  validateImageRepository(apiRepository, "release.apiRepository");
  validateImageRepository(webRepository, "release.webRepository");

  const exposureMode = exposure.mode;
  if (exposureMode !== "ingress" && exposureMode !== "nodePort") {
    throw new Error("Deployment exposure.mode must be ingress or nodePort.");
  }
  const host = requiredString(exposure, "host");
  if (exposureMode === "ingress") {
    validateDnsSubdomain(host, "exposure.host");
  }
  const ingressClassName = requiredString(exposure, "ingressClassName");
  validateDnsSubdomain(ingressClassName, "exposure.ingressClassName");
  const tlsSecretName = optionalString(exposure, "tlsSecretName");
  if (tlsSecretName) validateDnsSubdomain(tlsSecretName, "exposure.tlsSecretName");

  const postgres = parseStatefulDependency(
    requiredRecord(dependencies, "postgres"),
    "dependencies.postgres",
  );
  const redis = parseRedisDependency(
    requiredRecord(dependencies, "redis"),
    "dependencies.redis",
  );
  const objectStorageRecord = requiredRecord(dependencies, "objectStorage");
  assertOnlyKeys(
    objectStorageRecord,
    [
      "mode",
      "image",
      "secretName",
      "storageClassName",
      "storageSize",
      "bucket",
      "clientImage",
    ],
    "dependencies.objectStorage",
  );
  const objectStorage: ObjectStorageDependencyProfile = {
    ...parseStatefulDependency(
      objectStorageRecord,
      "dependencies.objectStorage",
      ["bucket", "clientImage"],
    ),
    bucket: requiredString(objectStorageRecord, "bucket"),
    clientImage: requiredString(objectStorageRecord, "clientImage"),
  };
  validateDnsLabel(objectStorage.bucket, "dependencies.objectStorage.bucket");
  validateImage(objectStorage.clientImage, "dependencies.objectStorage.clientImage");

  const parsedConfig = parseRuntimeConfig(runtimeConfig);
  const { baseUrl, checks } = parseVerification(verification);
  const profile: DeployProfileV1 = {
    schemaVersion: 1,
    driver: "kubernetes-helm",
    target: {
      context,
      clusterFingerprint,
      namespace,
      release: releaseName,
      createNamespace: false,
    },
    release: {
      strategy: "shared-tag",
      tagPattern,
      apiRepository,
      webRepository,
    },
    exposure: {
      mode: exposureMode,
      host,
      ingressClassName,
      tlsSecretName,
    },
    workloads: {
      api: parseWorkload(requiredRecord(workloads, "api"), "workloads.api"),
      web: parseWorkload(requiredRecord(workloads, "web"), "workloads.web"),
      worker:
        workloads.worker === null
          ? null
          : parseWorkload(requiredRecord(workloads, "worker"), "workloads.worker"),
    },
    dependencies: { postgres, redis, objectStorage },
    secrets: {
      api: parseNamedSecret(secrets.api, "secrets.api"),
      web:
        secrets.web === null
          ? null
          : parseNamedSecret(secrets.web, "secrets.web"),
      imagePull: requiredString(secrets, "imagePull"),
    },
    ...(migration
      ? { migration: { command: parseCommand(migration.command, "migration.command") } }
      : {}),
    runtimeConfig: parsedConfig,
    verification: { baseUrl, checks },
  };
  validateDnsLabel(profile.secrets.imagePull, "secrets.imagePull");
  return profile;
}

export function loadDeploymentProfile(projectRoot: string, name: string): DeployProfileV1 {
  const path = profilePath(projectRoot, name);
  if (!existsSync(path)) throw new Error(`Deployment profile "${name}" does not exist at ${path}.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Cannot read deployment profile "${name}": ${(error as Error).message}`);
  }
  return parseProfile(parsed);
}

export function listDeploymentProfiles(projectRoot: string): DeploymentProfileSummary[] {
  const directory = profileDirectory(projectRoot);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => {
      const name = entry.slice(0, -5);
      return { name, path: join(directory, entry), profile: loadDeploymentProfile(projectRoot, name) };
    });
}

export interface InitializeDeploymentProfileOptions {
  context: string;
  clusterFingerprint: string;
  host?: string;
}

export function initializeDeploymentProfile(
  projectRoot: string,
  name: string,
  options: InitializeDeploymentProfileOptions,
): DeploymentProfileSummary {
  const manifest = readManifest(projectRoot);
  if (!manifest) throw new Error("Not a PodoKit project: .podokit/manifest.json is missing.");
  const projectName = manifest.answers.projectName;
  if (!projectName) throw new Error("PodoKit manifest is missing answers.projectName.");
  const path = profilePath(projectRoot, name);
  if (existsSync(path)) throw new Error(`Deployment profile "${name}" already exists.`);
  const releaseName = projectName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (!releaseName) throw new Error("Project name cannot be converted to a Kubernetes release name.");
  const host = options.host ?? "app.example.com";
  const modules = new Set(manifest.modules.map((module) => module.name));
  const usesRedis = [...modules].some((module) =>
    ["redis", "bullmq", "job-progress", "rate-limit", "sse"].includes(module),
  );
  const usesObjectStorage = modules.has("object-storage-s3");
  const usesAuth = modules.has("auth");
  const apiRequiredKeys = [
    ...(usesAuth ? ["BETTER_AUTH_SECRET"] : []),
    ...(modules.has("api-key-auth") ? ["API_KEYS"] : []),
  ];
  const defaultProfile: DeployProfileV1 = {
    schemaVersion: 1,
    driver: "kubernetes-helm",
    target: {
      context: options.context,
      clusterFingerprint: options.clusterFingerprint,
      namespace: releaseName,
      release: releaseName,
      createNamespace: false,
    },
    release: {
      strategy: "shared-tag",
      tagPattern: STABLE_SEMVER_TAG_PATTERN,
      apiRepository: `ghcr.io/example/${releaseName}-api`,
      webRepository: `ghcr.io/example/${releaseName}-web`,
    },
    exposure: {
      mode: "ingress",
      host,
      ingressClassName: "traefik",
      tlsSecretName: null,
    },
    workloads: {
      api: {
        replicas: 2,
        resources: {
          cpuRequest: "250m",
          cpuLimit: "1000m",
          memoryRequest: "512Mi",
          memoryLimit: "1Gi",
        },
      },
      web: {
        replicas: 2,
        resources: {
          cpuRequest: "100m",
          cpuLimit: "500m",
          memoryRequest: "256Mi",
          memoryLimit: "1Gi",
        },
      },
      worker: modules.has("bullmq")
        ? {
            replicas: 1,
            resources: {
              cpuRequest: "100m",
              cpuLimit: "500m",
              memoryRequest: "256Mi",
              memoryLimit: "512Mi",
            },
          }
        : null,
    },
    dependencies: {
      postgres: {
        mode: "inCluster",
        image: "postgres:16.10-alpine",
        secretName: `${releaseName}-postgres`,
        storageClassName: "",
        storageSize: "8Gi",
      },
      redis: {
        mode: usesRedis ? "inCluster" : "disabled",
        image: "redis:7.4.5-alpine",
        secretName: `${releaseName}-redis`,
        storageClassName: "",
        storageSize: "4Gi",
      },
      objectStorage: {
        mode: usesObjectStorage ? "inCluster" : "disabled",
        image: "quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z",
        clientImage: "quay.io/minio/mc:RELEASE.2025-08-13T08-35-41Z",
        secretName: `${releaseName}-object-storage`,
        storageClassName: "",
        storageSize: "8Gi",
        bucket: "app",
      },
    },
    secrets: {
      api: {
        name: `${releaseName}-api`,
        requiredKeys: apiRequiredKeys,
      },
      web: null,
      imagePull: "registry-credentials",
    },
    runtimeConfig: {
      NODE_ENV: "production",
      CORS_ORIGIN: `https://${host}`,
      ADDRESS_HEADER: "x-forwarded-for",
      XFF_DEPTH: "1",
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
    },
    verification: {
      baseUrl: `https://${host}`,
      checks: [
        { path: "/", expectedStatus: 200 },
        { path: "/api/health", expectedStatus: 200, expectedJson: { status: "ok" } },
        {
          path: "/api/health/ready",
          expectedStatus: 200,
          expectedJson: { status: "ready" },
        },
      ],
    },
  };
  const validated = parseProfile(defaultProfile);
  mkdirSync(profileDirectory(projectRoot), { recursive: true });
  writeFileSync(path, `${JSON.stringify(validated, null, 2)}\n`, { flag: "wx" });
  return { name, path, profile: validated };
}

export function assertReleaseTag(profile: DeployProfileV1, release: string): void {
  if (release === "latest" || !new RegExp(profile.release.tagPattern).test(release)) {
    throw new Error(
      `Release "${release}" does not match deployment tag pattern ${profile.release.tagPattern}.`,
    );
  }
}

export function deploymentProfileDigest(profile: DeployProfileV1): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(profile)).digest("hex")}`;
}
