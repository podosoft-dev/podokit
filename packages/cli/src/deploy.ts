import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandRunner } from "./dev";
import {
  assertReleaseTag,
  deploymentProfileDigest,
  loadDeploymentProfile,
  type DeployProfileV1,
} from "./deploy-profile";
import {
  renderDeployment,
  type DeploymentImages,
  type DeploymentRuntime,
} from "./deploy-render";

export interface DeploymentDoctorFinding {
  code: string;
  ok: boolean;
  message: string;
}

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
  rolloutStateDigest: string;
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

export interface DeploymentStatus {
  profile: string;
  helmRevision: number | null;
  helmStatus: string;
  deployments: Array<{
    name: string;
    readyReplicas: number;
    replicas: number;
    images: string[];
    restartCount: number;
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
  metadata?: { name?: string };
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
  const findings: DeploymentDoctorFinding[] = [];
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
  return findings;
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

function clusterState(
  profile: DeployProfileV1,
  runner: CommandRunner,
): {
  dependencyRevision: number | null;
  dependencyStatus: string;
  clusterStateDigest: string;
  rolloutStateDigest: string;
} {
  const dependency = currentHelmStatus(
    profile,
    runner,
    `${profile.target.release}-dependencies`,
  );
  const secretReferences = referencedSecretNames(profile).map((name) => {
    const identity = checked(
      runner,
      "kubectl",
      kubectlArgs(profile, [
        "get",
        "secret",
        name,
        "-o",
        "jsonpath={.metadata.uid}:{.metadata.resourceVersion}",
      ]),
    ).trim();
    if (!/^[^:]+:[^:]+$/.test(identity)) {
      throw new Error(`Secret ${name} does not expose a stable Kubernetes identity.`);
    }
    return { name, identity };
  });
  const rolloutStateDigest = `sha256:${createHash("sha256")
    .update(JSON.stringify(secretReferences))
    .digest("hex")}`;
  return {
    dependencyRevision: dependency.revision,
    dependencyStatus: dependency.status,
    rolloutStateDigest,
    clusterStateDigest: `sha256:${createHash("sha256")
      .update(JSON.stringify({ dependency, secretReferences }))
      .digest("hex")}`,
  };
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

function restartCount(output: string, workloadName: string): number {
  const values = output
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.some((value) => !/^(0|[1-9][0-9]*)$/.test(value))) {
    throw new Error(
      `Kubernetes pod restart counts for ${workloadName} are invalid.`,
    );
  }
  return values.reduce((sum, value) => sum + Number(value), 0);
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
  const state = clusterState(profile, runner);
  const base: Omit<DeploymentPlan, "planHash"> = {
    profile: profileName,
    release,
    profileDigest: deploymentProfileDigest(profile),
    currentRevision: current.revision,
    currentStatus: current.status,
    ...state,
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
        description: "Reconcile in-cluster dependencies and wait for readiness.",
      },
      {
        order: 2,
        kind: "migration",
        description: `Run database migrations with ${images.api}.`,
      },
      {
        order: 3,
        kind: "application",
        description: `Roll out API, web${profile.workloads.worker ? ", and worker" : ""} workloads with zero unavailable replicas.`,
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
      state.rolloutStateDigest,
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

function acquireDeploymentLock(
  profile: DeployProfileV1,
  runner: CommandRunner,
): DeploymentLock {
  const name = deploymentLockName(profile);
  const holderIdentity = `podokit:${randomUUID()}`;
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
        acquireTime: new Date().toISOString(),
        renewTime: new Date().toISOString(),
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
      plan.rolloutStateDigest,
    );
    const failureFlag = helmFailureFlag(runner);
    const common = ["--wait", "--timeout", "5m", failureFlag];

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
    checked(
      runner,
      "kubectl",
      kubectlArgs(profile, ["wait", "--for=condition=complete", `job/${job}`, "--timeout=10m"]),
      false,
    );

    checked(
      runner,
      "helm",
      helmArgs(profile, [
        "upgrade",
        "--install",
        profile.target.release,
        runtime.applicationChart,
        ...common,
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
    const observedRestartCount = restartCount(
      checked(
        runner,
        "kubectl",
        kubectlArgs(profile, [
          "get",
          "pods",
          "-l",
          `app.kubernetes.io/name=${name}`,
          "-o",
          "jsonpath={range .items[*].status.containerStatuses[*]}{.restartCount}{\"\\n\"}{end}",
        ]),
      ),
      name,
    );
    return {
      name,
      readyReplicas: item.status?.readyReplicas ?? 0,
      replicas: item.spec?.replicas ?? 0,
      images: (item.spec?.template?.spec?.containers ?? [])
        .map((container) => container.image)
        .filter((image): image is string => typeof image === "string"),
      restartCount: observedRestartCount,
    };
  });
  return {
    profile: profileName,
    helmRevision: helm.revision,
    helmStatus: helm.status,
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
  const state = clusterState(profile, runner);
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
