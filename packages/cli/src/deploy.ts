import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { directApiRoutes } from "./api-paths";
import { readAppProxyTimeouts } from "./app-proxy-timeouts";
import {
  adminEmailsFinding,
  adminEmailsOnTarget,
  connectionBudgetWarning,
  installedModules,
  profileFindings,
  type DeployFinding,
} from "./deploy-checks";
import type { CommandRunner } from "./dev";
import {
  assertReleaseTag,
  deploymentProfileDigest,
  loadDeploymentProfile,
  type DeployProfileV1,
} from "./deploy-profile";
import {
  dependencyRollouts,
  describeDependencyRollout,
  keptRolloutChecksums,
  parseLiveDependencies,
  type DependencyRollout,
  type LiveDependency,
} from "./deploy-dependency-rollout";
import {
  renderDependencies,
  renderDeployment,
  rolloutChecksum,
  secretIdentityDigest,
  workloadSecretChecksum,
  workloadSecrets,
  type DeploymentImages,
  type DeploymentRuntime,
  type KubernetesRolloutState,
} from "./deploy-render";
import { readManifest } from "./lockfile";
import { resolveToolchain, toolchainMigrationCommand } from "./toolchain";

export type DeploymentDoctorFinding = DeployFinding;

export interface DeploymentPlanAction {
  order: number;
  kind:
    | "dependencies"
    | "migration"
    | "application"
    | "verification"
    | "rollback";
  description: string;
}

export interface DeploymentPlan {
  profile: string;
  release: string;
  planHash: string;
  profileDigest: string;
  currentRevision: number | null;
  currentStatus: string;
  dependencyRevision: number | null;
  dependencyStatus: string;
  clusterStateDigest: string;
  /** One checksum over the identity of every referenced Secret. */
  rolloutStateDigest: string;
  /** What each workload's rollout checksum is rendered from. */
  rolloutState: KubernetesRolloutState;
  /** Which in-cluster dependencies the apply creates, restarts, or keeps running, and why. */
  dependencyRollouts: DependencyRollout[];
  targetRevisionManifestDigest: string | null;
  target: {
    context: string;
    clusterFingerprint: string;
    namespace: string;
    helmRelease: string;
  };
  images: DeploymentImages;
  actions: DeploymentPlanAction[];
  warnings: string[];
}

/**
 * One migration Job's outcome. The Job itself is deleted an hour after it
 * finishes, so apply copies this into a ConfigMap that outlives it.
 */
export interface MigrationRecord {
  release: string;
  job: string;
  image: string;
  command: string[];
  startedAt: string | null;
  finishedAt: string | null;
  /** `incomplete`: apply stopped waiting while the Job still ran, or the Job could not be read. */
  result: "succeeded" | "failed" | "incomplete";
  reason?: string;
}

export interface DeploymentStatus {
  profile: string;
  helmRevision: number | null;
  helmStatus: string;
  /** The newest entry of the migration ledger, `<release>-migrations`; null before the first one. */
  lastMigration: MigrationRecord | null;
  deployments: Array<{
    name: string;
    readyReplicas: number;
    replicas: number;
    images: string[];
    /** Container restarts of the running pods of the Deployment's current revision. */
    restartCount: number;
    /**
     * Pods still listed that are not current: from an earlier revision, or
     * terminating. They linger for the termination grace period after a rollout.
     */
    previousPods: { count: number; restartCount: number };
  }>;
}

export interface VerificationResult {
  profile: string;
  baseUrl: string;
  ok: boolean;
  paths: Array<{ path: string; status: number | null; ok: boolean; error?: string }>;
}

interface HelmStatus {
  info?: { status?: string };
  version?: number;
}

interface ImageManifest {
  digest?: string;
}

interface KubernetesDeployment {
  metadata?: { name?: string; annotations?: Record<string, unknown> };
  spec?: {
    replicas?: number;
    template?: { spec?: { containers?: Array<{ image?: string }> } };
  };
  status?: { readyReplicas?: number };
}

interface DeploymentLock {
  name: string;
  holderIdentity: string;
}

function defaultRunner(
  command: string,
  args: string[],
  options: { capture: boolean },
): ReturnType<CommandRunner> {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: options.capture ? (result.stdout ?? "") : "",
    stderr: options.capture ? (result.stderr ?? "") : "",
  };
}

function checked(
  runner: CommandRunner,
  command: string,
  args: string[],
  capture = true,
): string {
  const result = runner(command, args, { capture });
  if (result.status !== 0) {
    const detail = capture ? result.stderr.trim() || result.stdout.trim() : "";
    throw new Error(
      `${command} ${args.join(" ")} failed with status ${String(result.status)}${detail ? `: ${detail}` : ""}`,
    );
  }
  return result.stdout;
}

function parseJson<T>(value: string, description: string): T {
  if (!value.trim()) throw new Error(`${description} returned empty JSON.`);
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(
      `${description} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function kubectlArgs(profile: DeployProfileV1, args: string[]): string[] {
  return ["--context", profile.target.context, "-n", profile.target.namespace, ...args];
}

function helmArgs(profile: DeployProfileV1, args: string[]): string[] {
  return [
    ...args,
    "--namespace",
    profile.target.namespace,
    "--kube-context",
    profile.target.context,
  ];
}

export function inspectClusterFingerprint(
  context: string,
  runner: CommandRunner = defaultRunner,
): string {
  const output = checked(runner, "kubectl", [
    "--context",
    context,
    "config",
    "view",
    "--raw",
    "--flatten",
    "--minify",
    "-o",
    'jsonpath={.clusters[0].cluster.server}{"\\n"}{.clusters[0].cluster.certificate-authority-data}',
  ]);
  if (!output.trim()) throw new Error(`Kubernetes context "${context}" has no cluster endpoint.`);
  return `sha256:${createHash("sha256").update(output.trim()).digest("hex")}`;
}

function assertClusterTarget(
  profile: DeployProfileV1,
  runner: CommandRunner,
): string {
  const observed = inspectClusterFingerprint(profile.target.context, runner);
  if (observed !== profile.target.clusterFingerprint) {
    throw new Error(
      `Cluster fingerprint mismatch: expected ${profile.target.clusterFingerprint}, received ${observed}.`,
    );
  }
  return observed;
}

function secretKeys(
  profile: DeployProfileV1,
  secretName: string,
  runner: CommandRunner,
): string[] | null {
  const result = runner(
    "kubectl",
    kubectlArgs(profile, [
      "get",
      "secret",
      secretName,
      "-o",
      'go-template={{range $key, $value := .data}}{{$key}}{{"\\n"}}{{end}}',
    ]),
    { capture: true },
  );
  if (result.status !== 0) return null;
  return result.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .sort();
}

// ADMIN_EMAILS is an allowlist of addresses, not a credential, so the doctor reads
// this one value of the API Secret to catch a placeholder. Every other value stays unread.
function secretAdminEmails(profile: DeployProfileV1, runner: CommandRunner): DeploymentDoctorFinding {
  const name = profile.secrets.api.name;
  const result = runner(
    "kubectl",
    kubectlArgs(profile, ["get", "secret", name, "-o", 'go-template={{with index .data "ADMIN_EMAILS"}}{{.}}{{end}}']),
    { capture: true },
  );
  if (result.status !== 0) {
    return {
      code: "admin-emails",
      ok: false,
      message: `Cannot read ADMIN_EMAILS from Secret ${name}: ${result.stderr.trim() || "the Secret is missing or inaccessible"}.`,
    };
  }
  return adminEmailsFinding(Buffer.from(result.stdout.trim(), "base64").toString("utf8"), `Secret ${name}`);
}

function dependencySecretRequirements(
  profile: DeployProfileV1,
): Array<{ name: string; keys: string[] }> {
  const requirements: Array<{ name: string; keys: string[] }> = [];
  if (profile.dependencies.postgres.mode === "inCluster") {
    requirements.push({
      name: profile.dependencies.postgres.secretName,
      keys: ["POSTGRES_DB", "POSTGRES_PASSWORD", "POSTGRES_USER"],
    });
  }
  if (profile.dependencies.redis.mode === "inCluster") {
    requirements.push({
      name: profile.dependencies.redis.secretName,
      keys: ["REDIS_PASSWORD"],
    });
  }
  if (profile.dependencies.objectStorage.mode === "inCluster") {
    requirements.push({
      name: profile.dependencies.objectStorage.secretName,
      keys: [
        "MINIO_ROOT_PASSWORD",
        "MINIO_ROOT_USER",
        "S3_ACCESS_KEY_ID",
        "S3_SECRET_ACCESS_KEY",
      ],
    });
  }
  return requirements;
}

function apiSecretRequirements(profile: DeployProfileV1): string[] {
  const keys = new Set(profile.secrets.api.requiredKeys);
  if (profile.dependencies.postgres.mode === "inCluster") {
    keys.add("POSTGRES_DB");
    keys.add("POSTGRES_PASSWORD");
    keys.add("POSTGRES_USER");
  }
  if (profile.dependencies.redis.mode === "inCluster") {
    keys.add("REDIS_PASSWORD");
  }
  if (profile.dependencies.objectStorage.mode === "inCluster") {
    keys.add("S3_ACCESS_KEY_ID");
    keys.add("S3_SECRET_ACCESS_KEY");
  }
  return [...keys].sort();
}

export function doctorDeployment(
  projectRoot: string,
  profileName: string,
  runner: CommandRunner = defaultRunner,
): DeploymentDoctorFinding[] {
  const profile = loadDeploymentProfile(projectRoot, profileName);
  const findings: DeploymentDoctorFinding[] = profileFindings(projectRoot, profile);
  const fingerprint = inspectClusterFingerprint(profile.target.context, runner);
  findings.push({
    code: "cluster-fingerprint",
    ok: fingerprint === profile.target.clusterFingerprint,
    message:
      fingerprint === profile.target.clusterFingerprint
        ? `Cluster fingerprint matches ${fingerprint}.`
        : `Cluster fingerprint mismatch: expected ${profile.target.clusterFingerprint}, received ${fingerprint}.`,
  });

  if (profile.exposure.mode === "ingress") {
    const ingressClass = runner(
      "kubectl",
      [
        "--context",
        profile.target.context,
        "get",
        "ingressclass",
        profile.exposure.ingressClassName,
        "-o",
        "name",
      ],
      { capture: true },
    );
    findings.push({
      code: `ingress-class:${profile.exposure.ingressClassName}`,
      ok: ingressClass.status === 0,
      message:
        ingressClass.status === 0
          ? `IngressClass ${profile.exposure.ingressClassName} exists.`
          : `IngressClass ${profile.exposure.ingressClassName} is missing or inaccessible.`,
    });
    if (profile.exposure.apiPaths.length > 0) {
      // Direct API paths remove /api with a Traefik Middleware resource.
      const middlewareCrd = runner(
        "kubectl",
        [
          "--context",
          profile.target.context,
          "get",
          "crd",
          "middlewares.traefik.io",
          "-o",
          "name",
        ],
        { capture: true },
      );
      findings.push({
        code: "crd:middlewares.traefik.io",
        ok: middlewareCrd.status === 0,
        message:
          middlewareCrd.status === 0
            ? "Traefik Middleware resources are available for exposure.apiPaths."
            : "exposure.apiPaths needs the Traefik Middleware CRD (middlewares.traefik.io); serve the IngressClass with Traefik or remove exposure.apiPaths.",
      });
    }
    if (profile.exposure.tlsSecretName) {
      const tlsType = runner(
        "kubectl",
        kubectlArgs(profile, [
          "get",
          "secret",
          profile.exposure.tlsSecretName,
          "-o",
          "jsonpath={.type}",
        ]),
        { capture: true },
      );
      findings.push({
        code: `secret:${profile.exposure.tlsSecretName}`,
        ok:
          tlsType.status === 0 &&
          tlsType.stdout.trim() === "kubernetes.io/tls",
        message:
          tlsType.status !== 0
            ? `TLS Secret ${profile.exposure.tlsSecretName} is missing or inaccessible.`
            : tlsType.stdout.trim() === "kubernetes.io/tls"
              ? `TLS Secret ${profile.exposure.tlsSecretName} has the expected type.`
              : `TLS Secret ${profile.exposure.tlsSecretName} must have type kubernetes.io/tls.`,
      });
    }
  }

  const namespace = runner(
    "kubectl",
    ["--context", profile.target.context, "get", "namespace", profile.target.namespace, "-o", "name"],
    { capture: true },
  );
  findings.push({
    code: "namespace",
    ok: namespace.status === 0,
    message:
      namespace.status === 0
        ? `Namespace ${profile.target.namespace} exists.`
        : `Namespace ${profile.target.namespace} is missing or inaccessible.`,
  });

  for (const verb of ["create", "delete"]) {
    const leasePermission = runner(
      "kubectl",
      kubectlArgs(profile, [
        "auth",
        "can-i",
        verb,
        "leases.coordination.k8s.io",
      ]),
      { capture: true },
    );
    findings.push({
      code: `lease-rbac:${verb}`,
      ok:
        leasePermission.status === 0 &&
        leasePermission.stdout.trim().toLowerCase() === "yes",
      message:
        leasePermission.status === 0 &&
        leasePermission.stdout.trim().toLowerCase() === "yes"
          ? `The deployment identity can ${verb} Kubernetes Leases.`
          : `The deployment identity cannot ${verb} Kubernetes Leases in namespace ${profile.target.namespace}.`,
    });
  }

  const helmVersion = runner("helm", ["version", "--short"], { capture: true });
  findings.push({
    code: "helm",
    ok: helmVersion.status === 0 && /^v[34]\./.test(helmVersion.stdout.trim()),
    message:
      helmVersion.status === 0
        ? `Helm version is ${helmVersion.stdout.trim()}.`
        : "Helm is unavailable.",
  });

  const imageResolver = runner("docker", ["buildx", "version"], { capture: true });
  findings.push({
    code: "image-resolver",
    ok: imageResolver.status === 0,
    message:
      imageResolver.status === 0
        ? "Docker Buildx is available for immutable image digest resolution."
        : "Docker Buildx is unavailable; release image digests cannot be resolved.",
  });

  for (const requirement of [
    { name: profile.secrets.api.name, keys: apiSecretRequirements(profile) },
    ...(profile.secrets.web
      ? [{ name: profile.secrets.web.name, keys: profile.secrets.web.requiredKeys }]
      : []),
    ...dependencySecretRequirements(profile),
  ]) {
    const keys = secretKeys(profile, requirement.name, runner);
    const missing = requirement.keys.filter((key) => !keys?.includes(key));
    findings.push({
      code: `secret:${requirement.name}`,
      ok: keys !== null && missing.length === 0,
      message:
        keys === null
          ? `Secret ${requirement.name} is missing or inaccessible.`
          : missing.length
            ? `Secret ${requirement.name} is missing required key(s): ${missing.join(", ")}.`
            : `Secret ${requirement.name} contains the required key names.`,
    });
  }

  if (adminEmailsOnTarget(projectRoot, profile)) findings.push(secretAdminEmails(profile, runner));

  const imagePullType = runner(
    "kubectl",
    kubectlArgs(profile, [
      "get",
      "secret",
      profile.secrets.imagePull,
      "-o",
      "jsonpath={.type}",
    ]),
    { capture: true },
  );
  const expectedImagePullType = "kubernetes.io/dockerconfigjson";
  findings.push({
    code: `secret:${profile.secrets.imagePull}`,
    ok:
      imagePullType.status === 0 &&
      imagePullType.stdout.trim() === expectedImagePullType,
    message:
      imagePullType.status !== 0
        ? `Image pull Secret ${profile.secrets.imagePull} is missing or inaccessible.`
        : imagePullType.stdout.trim() === expectedImagePullType
          ? `Image pull Secret ${profile.secrets.imagePull} has the expected type.`
          : `Image pull Secret ${profile.secrets.imagePull} must have type ${expectedImagePullType}.`,
  });

  for (const dependency of [
    profile.dependencies.postgres,
    profile.dependencies.redis,
    profile.dependencies.objectStorage,
  ]) {
    if (dependency.mode !== "inCluster" || !dependency.storageClassName) continue;
    const storage = runner(
      "kubectl",
      [
        "--context",
        profile.target.context,
        "get",
        "storageclass",
        dependency.storageClassName,
        "-o",
        "name",
      ],
      { capture: true },
    );
    findings.push({
      code: `storage-class:${dependency.storageClassName}`,
      ok: storage.status === 0,
      message:
        storage.status === 0
          ? `StorageClass ${dependency.storageClassName} exists.`
          : `StorageClass ${dependency.storageClassName} is missing or inaccessible.`,
    });
  }
  findings.push(...dependencyRestartFindings(profile, runner));
  return findings;
}

/**
 * Which running dependencies the next apply would restart, and why. The doctor
 * compares the profile's image tags, so a new digest behind the same tag shows
 * only in the plan, which resolves digests.
 */
function dependencyRestartFindings(
  profile: DeployProfileV1,
  runner: CommandRunner,
): DeploymentDoctorFinding[] {
  if (!inClusterDependencyNames(profile).length) return [];
  try {
    const references = secretReferences(profile, runner);
    // A missing Secret already fails above, and the plan refuses to run without it.
    if (!references) return [];
    const live = liveDependencies(profile, runner);
    const { secrets, legacyRolloutChecksum } = rolloutStateFrom(references);
    const state = dependencyRolloutState(profile, secrets, legacyRolloutChecksum, live);
    const { postgres, redis, objectStorage } = profile.dependencies;
    const rendered = renderDependencies(
      profile,
      {
        postgres: postgres.mode === "inCluster" ? postgres.image : null,
        redis: redis.mode === "inCluster" ? redis.image : null,
        objectStorage: objectStorage.mode === "inCluster" ? objectStorage.image : null,
        objectStorageClient: objectStorage.mode === "inCluster" ? objectStorage.clientImage : null,
      },
      state,
    ).dependencies;
    return dependencyRollouts(
      live,
      rendered,
      (current, tag) => current === tag || current?.startsWith(`${tag}@`) === true,
    ).map((rollout) => ({
      code: `dependency-restart:${rollout.name}`,
      ok: true,
      ...(rollout.action === "restart" ? { warning: true as const } : {}),
      message: `On the next apply, ${describeDependencyRollout(rollout)}`,
    }));
  } catch (error) {
    return [{
      code: "dependency-restart",
      ok: true,
      warning: true,
      message: `Cannot tell which dependencies the next apply restarts: ${(error as Error).message}`,
    }];
  }
}

function currentHelmStatus(
  profile: DeployProfileV1,
  runner: CommandRunner,
  releaseName = profile.target.release,
): { revision: number | null; status: string } {
  const result = runner(
    "helm",
    helmArgs(profile, ["status", releaseName, "-o", "json"]),
    { capture: true },
  );
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    if (/release(?:\s+\S+)?(?:\s+was)?\s+not\s+found|release:\s*not\s+found/i.test(detail)) {
      return { revision: null, status: "not-installed" };
    }
    throw new Error(
      `Unable to inspect Helm release ${releaseName}${detail ? `: ${detail}` : "."}`,
    );
  }
  const status = parseJson<HelmStatus>(
    result.stdout,
    `Helm status for release ${releaseName}`,
  );
  if (
    !Number.isInteger(status.version) ||
    (status.version ?? 0) < 1 ||
    typeof status.info?.status !== "string" ||
    !status.info.status.trim()
  ) {
    throw new Error(`Helm status for release ${releaseName} has an invalid schema.`);
  }
  return {
    revision: status.version!,
    status: status.info.status,
  };
}

function referencedSecretNames(profile: DeployProfileV1): string[] {
  return [
    profile.secrets.api.name,
    ...(profile.secrets.web ? [profile.secrets.web.name] : []),
    profile.secrets.imagePull,
    ...(profile.exposure.tlsSecretName ? [profile.exposure.tlsSecretName] : []),
    ...dependencySecretRequirements(profile).map((entry) => entry.name),
  ].filter((name, index, all) => all.indexOf(name) === index).sort();
}

interface SecretReference {
  name: string;
  identity: string;
}

function secretReference(
  profile: DeployProfileV1,
  name: string,
  runner: CommandRunner,
): SecretReference | null {
  const result = runner(
    "kubectl",
    kubectlArgs(profile, [
      "get",
      "secret",
      name,
      "-o",
      "jsonpath={.metadata.uid}:{.metadata.resourceVersion}",
    ]),
    { capture: true },
  );
  if (result.status !== 0) return null;
  const identity = result.stdout.trim();
  if (!/^[^:]+:[^:]+$/.test(identity)) {
    throw new Error(`Secret ${name} does not expose a stable Kubernetes identity.`);
  }
  return { name, identity };
}

/** The identity of every referenced Secret, or null when one cannot be read. */
function secretReferences(profile: DeployProfileV1, runner: CommandRunner): SecretReference[] | null {
  const references: SecretReference[] = [];
  for (const name of referencedSecretNames(profile)) {
    const reference = secretReference(profile, name, runner);
    if (!reference) return null;
    references.push(reference);
  }
  return references;
}

/**
 * Secret identities are uid:resourceVersion, which changes with every write to a
 * Secret, so a workload restarts to read new values. Only digests leave this
 * function: the identities themselves never reach a manifest or a plan.
 */
function rolloutStateFrom(references: SecretReference[]): {
  rolloutStateDigest: string;
  secrets: Record<string, string>;
  /** The rollout checksum PodoKit 1.6.5 and earlier gave every workload. */
  legacyRolloutChecksum: string;
} {
  const rolloutStateDigest = `sha256:${createHash("sha256")
    .update(JSON.stringify(references))
    .digest("hex")}`;
  const secrets: Record<string, string> = {};
  for (const { name, identity } of references) secrets[name] = secretIdentityDigest(name, identity);
  return { rolloutStateDigest, secrets, legacyRolloutChecksum: rolloutChecksum(rolloutStateDigest) };
}

function clusterState(
  profile: DeployProfileV1,
  runner: CommandRunner,
): {
  dependencyRevision: number | null;
  dependencyStatus: string;
  clusterStateDigest: string;
  rolloutStateDigest: string;
  secrets: Record<string, string>;
  legacyRolloutChecksum: string;
} {
  const dependency = currentHelmStatus(
    profile,
    runner,
    `${profile.target.release}-dependencies`,
  );
  const references = referencedSecretNames(profile).map((name) => {
    const reference = secretReference(profile, name, runner);
    if (!reference) throw new Error(`Secret ${name} is missing or inaccessible.`);
    return reference;
  });
  return {
    dependencyRevision: dependency.revision,
    dependencyStatus: dependency.status,
    ...rolloutStateFrom(references),
    clusterStateDigest: `sha256:${createHash("sha256")
      .update(JSON.stringify({ dependency, secretReferences: references }))
      .digest("hex")}`,
  };
}

function inClusterDependencyNames(profile: DeployProfileV1): string[] {
  const release = profile.target.release;
  return [
    ...(profile.dependencies.postgres.mode === "inCluster" ? [`${release}-postgres`] : []),
    ...(profile.dependencies.redis.mode === "inCluster" ? [`${release}-redis`] : []),
    ...(profile.dependencies.objectStorage.mode === "inCluster" ? [`${release}-minio`] : []),
  ];
}

/** The live dependency StatefulSets, read in one request; missing ones are left out. */
function liveDependencies(profile: DeployProfileV1, runner: CommandRunner): Map<string, LiveDependency> {
  const names = inClusterDependencyNames(profile);
  if (!names.length) return new Map();
  const output = checked(
    runner,
    "kubectl",
    kubectlArgs(profile, ["get", "statefulsets", ...names, "--ignore-not-found=true", "-o", "json"]),
  );
  return parseLiveDependencies(output, names);
}

/** Which dependencies keep their live rollout checksum, and the state to render with. */
function dependencyRolloutState(
  profile: DeployProfileV1,
  secrets: Record<string, string>,
  legacyRolloutChecksum: string | null,
  live: Map<string, LiveDependency>,
): KubernetesRolloutState {
  const consumed = workloadSecrets(profile);
  const expected = inClusterDependencyNames(profile).map((name) => ({
    name,
    secretChecksum: workloadSecretChecksum({ secrets, keep: {} }, consumed[name] ?? []),
  }));
  return { secrets, keep: keptRolloutChecksums(live, expected, legacyRolloutChecksum) };
}

function resolveImage(reference: string, runner: CommandRunner): string {
  if (/@sha256:[a-f0-9]{64}$/.test(reference)) return reference;
  const output = checked(runner, "docker", [
    "buildx",
    "imagetools",
    "inspect",
    reference,
    "--format",
    "{{json .Manifest}}",
  ]);
  const manifest = parseJson<ImageManifest>(
    output,
    `Image manifest inspection for ${reference}`,
  );
  if (!manifest.digest || !/^sha256:[a-f0-9]{64}$/.test(manifest.digest)) {
    throw new Error(`Unable to resolve immutable digest for image ${reference}.`);
  }
  return `${reference}@${manifest.digest}`;
}

function resolveDeploymentImages(
  profile: DeployProfileV1,
  release: string,
  runner: CommandRunner,
): DeploymentImages {
  return {
    api: resolveImage(`${profile.release.apiRepository}:${release}`, runner),
    web: resolveImage(`${profile.release.webRepository}:${release}`, runner),
    postgres:
      profile.dependencies.postgres.mode === "inCluster"
        ? resolveImage(profile.dependencies.postgres.image, runner)
        : null,
    redis:
      profile.dependencies.redis.mode === "inCluster"
        ? resolveImage(profile.dependencies.redis.image, runner)
        : null,
    objectStorage:
      profile.dependencies.objectStorage.mode === "inCluster"
        ? resolveImage(profile.dependencies.objectStorage.image, runner)
        : null,
    objectStorageClient:
      profile.dependencies.objectStorage.mode === "inCluster"
        ? resolveImage(profile.dependencies.objectStorage.clientImage, runner)
        : null,
  };
}

function parseDeployment(
  output: string,
  workloadName: string,
): KubernetesDeployment {
  const deployment = parseJson<KubernetesDeployment>(
    output,
    `Kubernetes Deployment ${workloadName}`,
  );
  const replicas = deployment.spec?.replicas;
  const readyReplicas = deployment.status?.readyReplicas ?? 0;
  const containers = deployment.spec?.template?.spec?.containers;
  if (
    deployment.metadata?.name !== workloadName ||
    !Number.isInteger(replicas) ||
    (replicas ?? -1) < 0 ||
    !Number.isInteger(readyReplicas) ||
    readyReplicas < 0 ||
    !Array.isArray(containers) ||
    containers.length === 0 ||
    containers.some(
      (container) =>
        typeof container.image !== "string" || container.image.length === 0,
    )
  ) {
    throw new Error(`Kubernetes Deployment ${workloadName} has an invalid schema.`);
  }
  return deployment;
}

const REVISION_ANNOTATION = "deployment.kubernetes.io/revision";
const POD_TEMPLATE_HASH_LABEL = "pod-template-hash";

function deploymentRevision(deployment: KubernetesDeployment, workloadName: string): string {
  const revision = deployment.metadata?.annotations?.[REVISION_ANNOTATION];
  if (typeof revision !== "string" || !/^[1-9][0-9]*$/.test(revision)) {
    throw new Error(
      `Kubernetes Deployment ${workloadName} has no valid ${REVISION_ANNOTATION} annotation.`,
    );
  }
  return revision;
}

function kubernetesListItems(output: string, description: string): unknown[] {
  const list = parseJson<unknown>(output, description);
  if (!isRecord(list) || !Array.isArray(list.items)) {
    throw new Error(`${description} returned an invalid list.`);
  }
  return list.items;
}

function optionalRecord(value: unknown): value is Record<string, unknown> | undefined {
  return value === undefined || isRecord(value);
}

/** The pod-template-hash of the ReplicaSet that carries the Deployment's revision. */
function currentPodTemplateHash(
  output: string,
  workloadName: string,
  revision: string,
): string {
  const description = `Kubernetes ReplicaSets of ${workloadName}`;
  const matching = kubernetesListItems(output, description).map((item) => {
    if (
      !isRecord(item) ||
      !isRecord(item.metadata) ||
      !optionalRecord(item.metadata.annotations) ||
      !optionalRecord(item.metadata.labels)
    ) {
      throw new Error(`${description} have an invalid schema.`);
    }
    return {
      revision: item.metadata.annotations?.[REVISION_ANNOTATION],
      hash: item.metadata.labels?.[POD_TEMPLATE_HASH_LABEL],
    };
  }).filter((replicaSet) => replicaSet.revision === revision);
  if (matching.length !== 1) {
    throw new Error(
      `Kubernetes Deployment ${workloadName} has ${matching.length} ReplicaSets for revision ${revision}; expected one.`,
    );
  }
  const hash = matching[0]!.hash;
  if (typeof hash !== "string" || hash.length === 0) {
    throw new Error(
      `${description}: revision ${revision} has no ${POD_TEMPLATE_HASH_LABEL} label.`,
    );
  }
  return hash;
}

interface PodRestarts {
  restartCount: number;
  previousPods: { count: number; restartCount: number };
}

/**
 * Restarts of the current revision's running pods, and of the rest separately.
 * Pods of every revision share the workload label, and an earlier ReplicaSet's
 * pods stay listed with a deletionTimestamp until they finish terminating.
 */
function podRestarts(output: string, workloadName: string, currentHash: string): PodRestarts {
  const description = `Kubernetes pods of ${workloadName}`;
  const result: PodRestarts = { restartCount: 0, previousPods: { count: 0, restartCount: 0 } };
  for (const pod of kubernetesListItems(output, description)) {
    if (
      !isRecord(pod) ||
      !isRecord(pod.metadata) ||
      !optionalRecord(pod.metadata.labels) ||
      (pod.status !== undefined && !isRecord(pod.status))
    ) {
      throw new Error(`${description} have an invalid schema.`);
    }
    // A pod that has not started a container yet reports no statuses.
    const statuses = pod.status?.containerStatuses ?? [];
    if (!Array.isArray(statuses)) throw new Error(`${description} have an invalid schema.`);
    let restarts = 0;
    for (const status of statuses) {
      const count = isRecord(status) ? status.restartCount : undefined;
      if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
        throw new Error(`Kubernetes pod restart counts for ${workloadName} are invalid.`);
      }
      restarts += count;
    }
    const terminating =
      pod.metadata.deletionTimestamp !== undefined && pod.metadata.deletionTimestamp !== null;
    if (!terminating && pod.metadata.labels?.[POD_TEMPLATE_HASH_LABEL] === currentHash) {
      result.restartCount += restarts;
    } else {
      result.previousPods.count += 1;
      result.previousPods.restartCount += restarts;
    }
  }
  return result;
}

function planDigest(input: Omit<DeploymentPlan, "planHash">, runtime: DeploymentRuntime): string {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .update(runtime.dependencyManifest)
    .update(runtime.applicationManifest)
    .update(readFileSync(runtime.migrationManifest))
    .digest("hex");
}

function workloadImageFromManifest(
  manifest: string,
  workloadName: string,
): string | null {
  for (const document of manifest.split(/\n---\s*\n/)) {
    if (!new RegExp(`^\\s*name:\\s*${workloadName}\\s*$`, "m").test(document)) continue;
    const match = document.match(/^\s*(?:-\s*)?image:\s*["']?([^"'\s]+)["']?\s*$/m);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function planDeployment(
  projectRoot: string,
  profileName: string,
  release: string,
  runner: CommandRunner = defaultRunner,
): DeploymentPlan {
  const profile = loadDeploymentProfile(projectRoot, profileName);
  assertReleaseTag(profile, release);
  const clusterFingerprint = assertClusterTarget(profile, runner);
  const current = currentHelmStatus(profile, runner);
  const images = resolveDeploymentImages(profile, release, runner);
  const { secrets, legacyRolloutChecksum, ...state } = clusterState(profile, runner);
  const live = liveDependencies(profile, runner);
  const rolloutState = dependencyRolloutState(profile, secrets, legacyRolloutChecksum, live);
  const rollouts = dependencyRollouts(live, renderDependencies(profile, images, rolloutState).dependencies);
  const restarts = rollouts.filter((rollout) => rollout.action === "restart");
  const base: Omit<DeploymentPlan, "planHash"> = {
    profile: profileName,
    release,
    profileDigest: deploymentProfileDigest(profile),
    currentRevision: current.revision,
    currentStatus: current.status,
    ...state,
    rolloutState,
    dependencyRollouts: rollouts,
    targetRevisionManifestDigest: null,
    target: {
      context: profile.target.context,
      clusterFingerprint,
      namespace: profile.target.namespace,
      helmRelease: profile.target.release,
    },
    images,
    actions: [
      {
        order: 1,
        kind: "dependencies",
        description: `Reconcile in-cluster dependencies and wait for readiness; ${
          rollouts.length === 0
            ? "none run in the cluster"
            : restarts.length
              ? `restart ${restarts.map((rollout) => rollout.name).join(", ")}`
              : "no running dependency restarts"
        }.`,
      },
      {
        order: 2,
        kind: "migration",
        description: `Run database migrations with ${images.api}.`,
      },
      {
        order: 3,
        kind: "application",
        description: `Roll out API, web${profile.workloads.worker ? ", and worker" : ""} workloads with zero unavailable replicas.${directApiRoutes(profile.exposure.apiPaths)}`,
      },
      {
        order: 4,
        kind: "verification",
        description: `Verify ${profile.verification.baseUrl}.`,
      },
    ],
    warnings: [
      "Application rollback does not reverse database migrations.",
      "PersistentVolumeClaims and Kubernetes Secrets are never deleted by apply or rollback.",
      ...restarts.map(describeDependencyRollout),
      ...[connectionBudgetWarning(profile, installedModules(projectRoot))].filter(
        (warning): warning is string => warning !== null,
      ),
    ],
  };
  const temporaryRoot = mkdtempSync(join(tmpdir(), "podokit-deploy-plan-"));
  try {
    const runtime = renderDeployment(
      temporaryRoot,
      profileName,
      profile,
      release,
      images,
      rolloutState,
      readAppProxyTimeouts(projectRoot),
    );
    return { ...base, planHash: planDigest(base, runtime) };
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function helmFailureFlag(runner: CommandRunner): string {
  const version = checked(runner, "helm", ["version", "--short"]).trim();
  return version.startsWith("v4.") ? "--rollback-on-failure" : "--atomic";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function managedStorageImage(
  resource: unknown,
  profile: DeployProfileV1,
): string | null {
  const name = `${profile.target.release}-minio`;
  if (
    !isRecord(resource) ||
    resource.apiVersion !== "apps/v1" ||
    resource.kind !== "StatefulSet" ||
    !isRecord(resource.metadata) ||
    resource.metadata.name !== name ||
    resource.metadata.namespace !== profile.target.namespace ||
    !isRecord(resource.spec) ||
    !isRecord(resource.spec.template) ||
    !isRecord(resource.spec.template.spec) ||
    !Array.isArray(resource.spec.template.spec.containers)
  ) {
    return null;
  }
  const containers: unknown[] = resource.spec.template.spec.containers;
  const container = containers[0];
  if (
    containers.length !== 1 ||
    !isRecord(container) ||
    container.name !== "minio" ||
    typeof container.image !== "string" ||
    !container.image.trim()
  ) {
    return null;
  }
  return container.image;
}

function jsonObjectStream(output: string): unknown[] | null {
  const documents: unknown[] = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < output.length; index += 1) {
    const character = output[index];
    if (start < 0) {
      if (/\s/.test(character ?? "")) continue;
      if (character !== "{") return null;
      start = index;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") depth += 1;
    else if (character === "}") depth -= 1;
    if (depth === 0) {
      try {
        documents.push(JSON.parse(output.slice(start, index + 1)) as unknown);
      } catch {
        return null;
      }
      start = -1;
    }
  }
  return start < 0 && documents.length > 0 ? documents : null;
}

function recordedStorageImage(
  profile: DeployProfileV1,
  runner: CommandRunner,
): string | null {
  const manifest = runner(
    "helm",
    helmArgs(profile, ["get", "manifest", `${profile.target.release}-dependencies`]),
    { capture: true },
  );
  if (manifest.status !== 0 || !manifest.stdout.trim()) return null;
  const temporaryRoot = mkdtempSync(join(tmpdir(), "podokit-storage-manifest-"));
  try {
    const path = join(temporaryRoot, "dependencies.yaml");
    writeFileSync(path, manifest.stdout, { mode: 0o600 });
    // Client dry-run parses Helm's YAML without submitting a create request to Kubernetes.
    const parsed = runner(
      "kubectl",
      kubectlArgs(profile, [
        "create", "--dry-run=client", "--validate=false", "-f", path, "-o", "json",
      ]),
      { capture: true },
    );
    if (parsed.status !== 0) return null;
    // kubectl prints consecutive JSON objects for a manifest containing multiple resources.
    const documents = jsonObjectStream(parsed.stdout);
    if (!documents) return null;
    const resources: unknown[] = [];
    for (const document of documents) {
      if (!isRecord(document)) return null;
      if (document.kind !== "List") resources.push(document);
      else if (document.apiVersion === "v1" && Array.isArray(document.items)) {
        resources.push(...document.items);
      } else return null;
    }
    const name = `${profile.target.release}-minio`;
    const matches: unknown[] = resources.filter(
      (item: unknown) => isRecord(item) && item.kind === "StatefulSet" &&
        isRecord(item.metadata) && item.metadata.name === name,
    );
    return matches.length === 1 ? managedStorageImage(matches[0], profile) : null;
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function dependencyRollbackWarning(
  profile: DeployProfileV1,
  plan: DeploymentPlan,
  runner: CommandRunner,
): string | null {
  if (profile.dependencies.objectStorage.mode !== "inCluster") return null;
  const name = `${profile.target.release}-minio`;
  const current = runner(
    "kubectl",
    kubectlArgs(profile, ["get", "statefulset", name, "--ignore-not-found=true", "-o", "json"]),
    { capture: true },
  );
  if (current.status !== 0) return "the current managed storage image could not be inspected";
  if (!current.stdout.trim()) {
    return plan.dependencyRevision === null
      ? null
      : "the existing managed storage StatefulSet is missing";
  }
  let resource: unknown;
  try {
    resource = JSON.parse(current.stdout) as unknown;
  } catch {
    return "the managed storage StatefulSet has an invalid schema";
  }
  const currentImage = managedStorageImage(resource, profile);
  if (!currentImage || typeof plan.images.objectStorage !== "string") {
    return "the current managed storage image could not be confirmed";
  }
  if (currentImage !== plan.images.objectStorage) {
    return "the managed storage server image is changing";
  }
  // A failed revision can already contain the new image while Helm's rollback target uses the old one.
  if (plan.dependencyRevision !== null && plan.dependencyStatus !== "deployed") {
    return "the previous dependency release is not deployed";
  }
  if (plan.dependencyRevision !== null) {
    const recordedImage = recordedStorageImage(profile, runner);
    if (!recordedImage) return "the storage image recorded by Helm could not be confirmed";
    if (recordedImage !== currentImage) return "the storage image recorded by Helm differs from the current image";
  }
  return null;
}

function waitForDependencies(
  profile: DeployProfileV1,
  runner: CommandRunner,
): void {
  const release = profile.target.release;
  const resources: Array<[string, string]> = [];
  if (profile.dependencies.postgres.mode === "inCluster") {
    resources.push(["statefulset", `${release}-postgres`]);
  }
  if (profile.dependencies.redis.mode === "inCluster") {
    resources.push(["statefulset", `${release}-redis`]);
  }
  if (profile.dependencies.objectStorage.mode === "inCluster") {
    resources.push(["statefulset", `${release}-minio`]);
  }
  for (const [kind, name] of resources) {
    checked(
      runner,
      "kubectl",
      kubectlArgs(profile, ["rollout", "status", `${kind}/${name}`, "--timeout=5m"]),
      false,
    );
  }
  if (profile.dependencies.objectStorage.mode === "inCluster") {
    checked(
      runner,
      "kubectl",
      kubectlArgs(profile, [
        "wait",
        "--for=condition=complete",
        "job",
        "-l",
        `app.kubernetes.io/name=${release}-minio-initialize`,
        "--timeout=5m",
      ]),
      false,
    );
  }
}

const MIGRATION_LEDGER_KEY = "migrations.json";
const MIGRATION_LEDGER_DEPTH = 20;

export function migrationLedgerName(profile: DeployProfileV1): string {
  return `${profile.target.release}-migrations`;
}

function isMigrationRecord(value: unknown): value is MigrationRecord {
  const optionalText = (entry: unknown) => entry === null || typeof entry === "string";
  return (
    isRecord(value) &&
    typeof value.release === "string" &&
    typeof value.job === "string" &&
    typeof value.image === "string" &&
    Array.isArray(value.command) &&
    value.command.every((part) => typeof part === "string") &&
    optionalText(value.startedAt) &&
    optionalText(value.finishedAt) &&
    (value.result === "succeeded" || value.result === "failed" || value.result === "incomplete") &&
    (value.reason === undefined || typeof value.reason === "string")
  );
}

/** The recorded migration outcomes, oldest first. */
export function readMigrationLedger(profile: DeployProfileV1, runner: CommandRunner): MigrationRecord[] {
  const name = migrationLedgerName(profile);
  const output = checked(
    runner,
    "kubectl",
    kubectlArgs(profile, ["get", "configmap", name, "--ignore-not-found=true", "-o", "json"]),
  );
  if (!output.trim()) return [];
  const configMap = parseJson<unknown>(output, `ConfigMap ${name}`);
  const ledger = isRecord(configMap) && isRecord(configMap.data) ? configMap.data[MIGRATION_LEDGER_KEY] : undefined;
  const parsed = typeof ledger === "string" ? parseJson<unknown>(ledger, `ConfigMap ${name} ${MIGRATION_LEDGER_KEY}`) : null;
  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== 1 ||
    !Array.isArray(parsed.entries) ||
    !parsed.entries.every(isMigrationRecord)
  ) {
    throw new Error(`ConfigMap ${name} does not hold a valid migration ledger.`);
  }
  return parsed.entries;
}

function condition(conditions: unknown, type: string): Record<string, unknown> | undefined {
  return Array.isArray(conditions)
    ? conditions.find((entry): entry is Record<string, unknown> =>
        isRecord(entry) && entry.type === type && entry.status === "True")
    : undefined;
}

/** What the finished, failed, or still running migration Job reports about itself. */
function migrationOutcome(
  profile: DeployProfileV1,
  release: string,
  job: string,
  rendered: { image: string; command: string[] },
  runner: CommandRunner,
): MigrationRecord {
  const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
  const result = runner("kubectl", kubectlArgs(profile, ["get", "job", job, "-o", "json"]), { capture: true });
  let resource: unknown = null;
  try {
    resource = result.status === 0 ? JSON.parse(result.stdout) as unknown : null;
  } catch {
    resource = null;
  }
  const status = isRecord(resource) && isRecord(resource.status) ? resource.status : null;
  const spec = isRecord(resource) && isRecord(resource.spec) && isRecord(resource.spec.template) &&
    isRecord(resource.spec.template.spec) ? resource.spec.template.spec : null;
  const container = Array.isArray(spec?.containers) && isRecord(spec.containers[0]) ? spec.containers[0] : null;
  const command = Array.isArray(container?.command) && container.command.every((part) => typeof part === "string")
    ? container.command
    : rendered.command;
  const record = {
    release,
    job,
    image: text(container?.image) ?? rendered.image,
    command,
    startedAt: text(status?.startTime),
  };
  if (!status) {
    return { ...record, finishedAt: null, result: "incomplete", reason: "the Job could not be read" };
  }
  const complete = condition(status.conditions, "Complete");
  if (complete) {
    return {
      ...record,
      finishedAt: text(status.completionTime) ?? text(complete.lastTransitionTime),
      result: "succeeded",
    };
  }
  const failed = condition(status.conditions, "Failed");
  if (failed) {
    return {
      ...record,
      finishedAt: text(failed.lastTransitionTime),
      result: "failed",
      reason: [text(failed.reason), text(failed.message)].filter(Boolean).join(": ") || "the Job failed",
    };
  }
  return { ...record, finishedAt: null, result: "incomplete", reason: "the Job was still running when apply stopped waiting" };
}

/**
 * Appends the migration Job's outcome to the ledger ConfigMap, under the apply's
 * Lease. A failed write is reported and does not stop the deployment: the
 * migration has already run, and the ledger only describes it.
 */
function recordMigration(profile: DeployProfileV1, record: MigrationRecord, runner: CommandRunner): void {
  const name = migrationLedgerName(profile);
  const temporaryRoot = mkdtempSync(join(tmpdir(), "podokit-migration-ledger-"));
  try {
    const entries = [...readMigrationLedger(profile, runner), record].slice(-MIGRATION_LEDGER_DEPTH);
    const path = join(temporaryRoot, "ledger.json");
    writeFileSync(
      path,
      JSON.stringify({
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: {
          name,
          labels: { "app.kubernetes.io/name": name, "app.kubernetes.io/managed-by": "podokit" },
        },
        data: { [MIGRATION_LEDGER_KEY]: JSON.stringify({ schemaVersion: 1, entries }, null, 2) },
      }),
      { mode: 0o600 },
    );
    checked(
      runner,
      "kubectl",
      kubectlArgs(profile, ["apply", "--server-side", "--field-manager=podokit", "--force-conflicts", "-f", path]),
    );
  } catch (error) {
    console.warn(
      `The migration ${record.result === "succeeded" ? "succeeded" : `result (${record.result})`} could not be recorded in ConfigMap ${name}: ${(error as Error).message}`,
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function migrationJobName(profile: DeployProfileV1, release: string): string {
  const slug = release.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${profile.target.release}-migrate-${slug}`;
}

function deploymentLockName(profile: DeployProfileV1): string {
  const suffix = createHash("sha256")
    .update(profile.target.release)
    .digest("hex")
    .slice(0, 8);
  const prefix = profile.target.release.slice(0, 39).replace(/-+$/g, "");
  return `${prefix}-${suffix}-deploy-lock`;
}

function kubernetesMicroTime(date: Date): string {
  return `${date.toISOString().slice(0, -1)}000Z`;
}

function acquireDeploymentLock(
  profile: DeployProfileV1,
  runner: CommandRunner,
): DeploymentLock {
  const name = deploymentLockName(profile);
  const holderIdentity = `podokit:${randomUUID()}`;
  const timestamp = kubernetesMicroTime(new Date());
  const temporaryRoot = mkdtempSync(join(tmpdir(), "podokit-deploy-lock-"));
  const manifestPath = join(temporaryRoot, "lease.json");
  writeFileSync(
    manifestPath,
    JSON.stringify({
      apiVersion: "coordination.k8s.io/v1",
      kind: "Lease",
      metadata: {
        name,
        labels: { "app.kubernetes.io/managed-by": "podokit" },
      },
      spec: {
        holderIdentity,
        leaseDurationSeconds: 3600,
        acquireTime: timestamp,
        renewTime: timestamp,
      },
    }),
  );
  try {
    const result = runner(
      "kubectl",
      kubectlArgs(profile, ["create", "-f", manifestPath]),
      { capture: true },
    );
    if (result.status !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim();
      if (/\balready\s+exists\b/i.test(detail)) {
        const holder = checked(
          runner,
          "kubectl",
          kubectlArgs(profile, [
            "get",
            "lease",
            name,
            "-o",
            "jsonpath={.spec.holderIdentity}",
          ]),
        ).trim();
        throw new Error(
          `Deployment lock ${name} is already held${holder ? ` by ${holder}` : ""}. ` +
          `Inspect the active deployment before deleting a stale Lease.`,
        );
      }
      throw new Error(
        `Unable to acquire deployment lock ${name}${detail ? `: ${detail}` : "."}`,
      );
    }
    return { name, holderIdentity };
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function releaseDeploymentLock(
  profile: DeployProfileV1,
  lock: DeploymentLock,
  runner: CommandRunner,
): void {
  const holder = checked(
    runner,
    "kubectl",
    kubectlArgs(profile, [
      "get",
      "lease",
      lock.name,
      "-o",
      "jsonpath={.spec.holderIdentity}",
    ]),
  ).trim();
  if (holder !== lock.holderIdentity) {
    throw new Error(
      `Deployment lock ${lock.name} changed owners and was not released.`,
    );
  }
  checked(
    runner,
    "kubectl",
    kubectlArgs(profile, ["delete", "lease", lock.name, "--wait=true"]),
    false,
  );
}

export async function applyDeployment(
  projectRoot: string,
  profileName: string,
  release: string,
  confirmation: string,
  runner: CommandRunner = defaultRunner,
  fetcher: typeof fetch = fetch,
): Promise<DeploymentStatus> {
  const profile = loadDeploymentProfile(projectRoot, profileName);
  const findings = doctorDeployment(projectRoot, profileName, runner);
  const failed = findings.filter((finding) => !finding.ok);
  if (failed.length) {
    throw new Error(`Deployment doctor failed: ${failed.map((finding) => finding.message).join(" ")}`);
  }
  const lock = acquireDeploymentLock(profile, runner);
  try {
    const plan = planDeployment(projectRoot, profileName, release, runner);
    if (confirmation !== plan.planHash) {
      throw new Error(`Deployment plan hash changed. Expected confirmation ${plan.planHash}.`);
    }
    const runtime = renderDeployment(
      projectRoot,
      profileName,
      profile,
      release,
      plan.images,
      plan.rolloutState,
    );
    const failureFlag = helmFailureFlag(runner);
    const common = ["--wait", "--timeout", "5m"];
    const rollbackWarning = dependencyRollbackWarning(profile, plan, runner);
    if (rollbackWarning) {
      console.warn(
        `Disable automatic dependency rollback because ${rollbackWarning}. ` +
        "If the upgrade fails, stop storage and restore the complete data and IAM backup before starting the previous image. " +
        "Application upgrades retain automatic rollback.",
      );
    }

    if (profile.dependencies.objectStorage.mode === "inCluster") {
      checked(
        runner,
        "kubectl",
        kubectlArgs(profile, [
          "delete",
          "job",
          "-l",
          `app.kubernetes.io/name=${profile.target.release}-minio-initialize`,
          "--ignore-not-found=true",
          "--wait=true",
        ]),
        false,
      );
    }
    checked(
      runner,
      "helm",
      helmArgs(profile, [
        "upgrade",
        "--install",
        `${profile.target.release}-dependencies`,
        runtime.dependencyChart,
        ...common,
        ...(rollbackWarning ? [] : [failureFlag]),
      ]),
      false,
    );
    waitForDependencies(profile, runner);

    const job = migrationJobName(profile, release);
    checked(
      runner,
      "kubectl",
      kubectlArgs(profile, ["delete", "job", job, "--ignore-not-found=true", "--wait=true"]),
      false,
    );
    checked(
      runner,
      "kubectl",
      kubectlArgs(profile, ["apply", "-f", runtime.migrationManifest]),
      false,
    );
    let migrationError: unknown = null;
    try {
      checked(
        runner,
        "kubectl",
        kubectlArgs(profile, ["wait", "--for=condition=complete", `job/${job}`, "--timeout=10m"]),
        false,
      );
    } catch (error) {
      migrationError = error;
    }
    const command = profile.migration?.command ??
      toolchainMigrationCommand(readManifest(projectRoot)?.toolchain ?? resolveToolchain());
    recordMigration(
      profile,
      migrationOutcome(profile, release, job, { image: plan.images.api, command }, runner),
      runner,
    );
    if (migrationError) throw migrationError;

    checked(
      runner,
      "helm",
      helmArgs(profile, [
        "upgrade",
        "--install",
        profile.target.release,
        runtime.applicationChart,
        ...common,
        failureFlag,
      ]),
      false,
    );
    for (const kind of [
      "api",
      "web",
      ...(profile.workloads.worker ? ["worker"] : []),
    ]) {
      checked(
        runner,
        "kubectl",
        kubectlArgs(profile, [
          "rollout",
          "status",
          `deployment/${profile.target.release}-${kind}`,
          "--timeout=5m",
        ]),
        false,
      );
    }
    const verification = await verifyDeployment(projectRoot, profileName, fetcher);
    if (!verification.ok) {
      const deployed = currentHelmStatus(profile, runner);
      throw new Error(
        `Deployment verification failed after Helm revision ${deployed.revision ?? "unknown"} was deployed. ` +
        `The new application remains deployed because database migrations cannot be reversed automatically. ` +
        `Prepare a forward fix or explicitly plan a compatible rollback. Failed checks: ${verification.paths
          .filter((entry) => !entry.ok)
          .map((entry) => `${entry.path} (${entry.status ?? entry.error ?? "unknown"})`)
          .join(", ")}`,
      );
    }
    return getDeploymentStatus(projectRoot, profileName, runner);
  } finally {
    releaseDeploymentLock(profile, lock, runner);
  }
}

export function getDeploymentStatus(
  projectRoot: string,
  profileName: string,
  runner: CommandRunner = defaultRunner,
): DeploymentStatus {
  const profile = loadDeploymentProfile(projectRoot, profileName);
  assertClusterTarget(profile, runner);
  const helm = currentHelmStatus(profile, runner);
  const workloadNames = [
    `${profile.target.release}-api`,
    `${profile.target.release}-web`,
    ...(profile.workloads.worker ? [`${profile.target.release}-worker`] : []),
  ];
  const items = workloadNames.flatMap((workloadName) => {
    const result = runner(
      "kubectl",
      kubectlArgs(profile, [
      "get",
      "deployment",
      workloadName,
      "-o",
      "json",
      ]),
      { capture: true },
    );
    if (result.status === 0) {
      return [parseDeployment(result.stdout, workloadName)];
    }
    const detail = result.stderr.trim() || result.stdout.trim();
    if (/\bnot\s*found\b/i.test(detail)) return [];
    throw new Error(
      `Unable to inspect Kubernetes deployment ${workloadName}${detail ? `: ${detail}` : "."}`,
    );
  });
  const deployments = items.map((item) => {
    const name = item.metadata!.name!;
    const selector = `app.kubernetes.io/name=${name}`;
    const currentHash = currentPodTemplateHash(
      checked(
        runner,
        "kubectl",
        kubectlArgs(profile, ["get", "replicasets", "-l", selector, "-o", "json"]),
      ),
      name,
      deploymentRevision(item, name),
    );
    const restarts = podRestarts(
      checked(
        runner,
        "kubectl",
        kubectlArgs(profile, ["get", "pods", "-l", selector, "-o", "json"]),
      ),
      name,
      currentHash,
    );
    return {
      name,
      readyReplicas: item.status?.readyReplicas ?? 0,
      replicas: item.spec?.replicas ?? 0,
      images: (item.spec?.template?.spec?.containers ?? [])
        .map((container) => container.image)
        .filter((image): image is string => typeof image === "string"),
      ...restarts,
    };
  });
  return {
    profile: profileName,
    helmRevision: helm.revision,
    helmStatus: helm.status,
    lastMigration: readMigrationLedger(profile, runner).at(-1) ?? null,
    deployments,
  };
}

export async function verifyDeployment(
  projectRoot: string,
  profileName: string,
  fetcher: typeof fetch = fetch,
): Promise<VerificationResult> {
  const profile = loadDeploymentProfile(projectRoot, profileName);
  const paths: VerificationResult["paths"] = [];
  for (const check of profile.verification.checks) {
    try {
      const response = await fetcher(new URL(check.path, profile.verification.baseUrl), {
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
      let ok = response.status === check.expectedStatus;
      if (ok && check.expectedJson) {
        const body = await response.json().catch(() => null) as unknown;
        ok =
          typeof body === "object" &&
          body !== null &&
          Object.entries(check.expectedJson).every(
            ([key, value]) => (body as Record<string, unknown>)[key] === value,
          );
      }
      paths.push({ path: check.path, status: response.status, ok });
    } catch (error) {
      paths.push({
        path: check.path,
        status: null,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    profile: profileName,
    baseUrl: profile.verification.baseUrl,
    ok: paths.every((entry) => entry.ok),
    paths,
  };
}

export function planRollback(
  projectRoot: string,
  profileName: string,
  revision: number,
  runner: CommandRunner = defaultRunner,
): DeploymentPlan {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new Error("Rollback revision must be a positive integer.");
  }
  const profile = loadDeploymentProfile(projectRoot, profileName);
  const clusterFingerprint = assertClusterTarget(profile, runner);
  const current = currentHelmStatus(profile, runner);
  if (current.revision === null) throw new Error("Cannot roll back an application that is not installed.");
  const { secrets, legacyRolloutChecksum: _legacy, ...state } = clusterState(profile, runner);
  // A rollback changes neither the dependencies nor how their checksums are rendered.
  const rolloutState: KubernetesRolloutState = { secrets, keep: {} };
  const targetManifest = checked(
    runner,
    "helm",
    helmArgs(profile, [
      "get",
      "manifest",
      profile.target.release,
      "--revision",
      String(revision),
    ]),
  );
  const apiImage = workloadImageFromManifest(
    targetManifest,
    `${profile.target.release}-api`,
  );
  const webImage = workloadImageFromManifest(
    targetManifest,
    `${profile.target.release}-web`,
  );
  if (!apiImage || !webImage) {
    throw new Error(`Helm revision ${revision} does not contain the expected API and web workloads.`);
  }
  const targetRevisionManifestDigest = `sha256:${createHash("sha256")
    .update(targetManifest)
    .digest("hex")}`;
  const release = `revision-${revision}`;
  const base: Omit<DeploymentPlan, "planHash"> = {
    profile: profileName,
    release,
    profileDigest: deploymentProfileDigest(profile),
    currentRevision: current.revision,
    currentStatus: current.status,
    ...state,
    rolloutState,
    dependencyRollouts: [],
    targetRevisionManifestDigest,
    target: {
      context: profile.target.context,
      clusterFingerprint,
      namespace: profile.target.namespace,
      helmRelease: profile.target.release,
    },
    images: {
      api: apiImage,
      web: webImage,
      postgres: null,
      redis: null,
      objectStorage: null,
      objectStorageClient: null,
    },
    actions: [
      {
        order: 1,
        kind: "rollback",
        description: `Roll back application release ${profile.target.release} to revision ${revision}.`,
      },
      {
        order: 2,
        kind: "verification",
        description: `Verify ${profile.verification.baseUrl}.`,
      },
    ],
    warnings: [
      "Rollback does not reverse database migrations.",
      "Dependency releases, PersistentVolumeClaims, and Secrets are not changed.",
    ],
  };
  const planHash = createHash("sha256")
    .update(JSON.stringify(base))
    .update(targetManifest)
    .digest("hex");
  return { ...base, planHash };
}

export async function rollbackDeployment(
  projectRoot: string,
  profileName: string,
  revision: number,
  confirmation: string,
  runner: CommandRunner = defaultRunner,
  fetcher: typeof fetch = fetch,
): Promise<DeploymentStatus> {
  const profile = loadDeploymentProfile(projectRoot, profileName);
  const lock = acquireDeploymentLock(profile, runner);
  try {
    const plan = planRollback(projectRoot, profileName, revision, runner);
    if (confirmation !== plan.planHash) {
      throw new Error(`Rollback plan hash changed. Expected confirmation ${plan.planHash}.`);
    }
    checked(
      runner,
      "helm",
      helmArgs(profile, [
        "rollback",
        profile.target.release,
        String(revision),
        "--wait",
        "--timeout",
        "5m",
      ]),
      false,
    );
    for (const kind of [
      "api",
      "web",
      ...(profile.workloads.worker ? ["worker"] : []),
    ]) {
      const deployment = `deployment/${profile.target.release}-${kind}`;
      checked(
        runner,
        "kubectl",
        kubectlArgs(profile, ["rollout", "restart", deployment]),
        false,
      );
      checked(
        runner,
        "kubectl",
        kubectlArgs(profile, ["rollout", "status", deployment, "--timeout=5m"]),
        false,
      );
    }
    const verification = await verifyDeployment(projectRoot, profileName, fetcher);
    if (!verification.ok) throw new Error("Rollback completed, but public verification failed.");
    return getDeploymentStatus(projectRoot, profileName, runner);
  } finally {
    releaseDeploymentLock(profile, lock, runner);
  }
}
