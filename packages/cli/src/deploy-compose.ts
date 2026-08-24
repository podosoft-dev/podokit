import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { CommandRunner } from "./dev";
import { loadComposeProfile } from "./deploy-driver";
import {
  LEDGER_PATH,
  LOCK_PATH,
  checked,
  composeProjectPs,
  currentLedgerEntry,
  defaultRunner,
  dockerArgs,
  parseJson,
  probeImage,
  readLedger,
  runCompose,
  sshDestination,
  stateScript,
  stateVolumeName,
  type Ledger,
} from "./deploy-compose-exec";
import { readComposeSyncDrift, type ComposeSyncDrift } from "./deploy-compose-sync";
import {
  composeProfileDigest,
  type DockerComposeProfileV1,
} from "./deploy-compose-profile";
import {
  defaultComposeImages,
  renderComposeDeployment,
  rolloutStateDigest,
  serviceName,
  type ComposeImages,
} from "./deploy-compose-render";
import { assertAnyReleaseTag } from "./deploy-driver";
import { readManifest } from "./lockfile";
import { resolveToolchain, toolchainMigrationCommand } from "./toolchain";

/**
 * The Docker Compose deployment driver.
 *
 * Every safety property the Kubernetes driver has is reproduced here with the
 * primitives Compose offers: a fingerprint pins the target endpoint, a plan binds
 * resolved image digests and rendered bytes to one hash that apply must echo back, a
 * lock file in a state volume replaces the Kubernetes Lease, and a release ledger in
 * that same volume replaces Helm revisions.
 */

export interface ComposeDoctorFinding {
  code: string;
  ok: boolean;
  message: string;
}

export interface ComposePlanAction {
  order: number;
  kind: "dependencies" | "migration" | "application" | "verification" | "rollback";
  description: string;
}

export interface ComposePlan {
  profile: string;
  release: string;
  planHash: string;
  profileDigest: string;
  currentRevision: number | null;
  currentRelease: string | null;
  hostStateDigest: string;
  rolloutStateDigest: string;
  composeDocumentDigest: string;
  target: { context: string; endpointFingerprint: string; project: string };
  images: ComposeImages;
  actions: ComposePlanAction[];
  warnings: string[];
}

export interface ComposeStatus {
  profile: string;
  revision: number | null;
  release: string | null;
  services: Array<{
    name: string;
    running: number;
    desired: number;
    images: string[];
    health: string;
    restartCount: number;
  }>;
  /**
   * Containers running locally synced artifacts instead of their image's.
   *
   * Reported beside the release because the two disagree when it is non-empty: the
   * tag says one thing and the running code is another. Empty is the normal state.
   */
  syncDrift: ComposeSyncDrift[];
}

export interface ComposeVerificationResult {
  profile: string;
  baseUrl: string;
  ok: boolean;
  paths: Array<{ path: string; status: number | null; ok: boolean; error?: string }>;
}

interface DockerContextInspect {
  Name?: string;
  Endpoints?: { docker?: { Host?: string; SkipTLSVerify?: boolean } };
}

interface ComposePsEntry {
  Name?: string;
  Service?: string;
  Image?: string;
  State?: string;
  Health?: string;
}

interface ContainerInspect {
  Image?: string;
  RestartCount?: number;
  State?: { Health?: { Status?: string }; Status?: string };
  Config?: { Image?: string };
}

interface ImageManifest {
  digest?: string;
}

/** How many rollback targets the ledger keeps. */
const LEDGER_DEPTH = 10;

function digest(parts: string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\0");
  return `sha256:${hash.digest("hex")}`;
}

/**
 * The endpoint identity a profile is pinned to.
 *
 * The Kubernetes driver fingerprints the cluster server and CA; the closest stable
 * equivalent here is the context's Docker endpoint plus the daemon's own ID, so
 * repointing a context at a different host invalidates the profile instead of
 * silently deploying somewhere else.
 */
export function inspectComposeEndpointFingerprint(
  context: string,
  runner: CommandRunner = defaultRunner,
): string {
  const contextOutput = checked(runner, "docker", [
    "context",
    "inspect",
    context,
    "--format",
    "{{json .}}",
  ]);
  const parsed = parseJson<DockerContextInspect | DockerContextInspect[]>(
    contextOutput,
    `Docker context inspection for ${context}`,
  );
  const record = Array.isArray(parsed) ? parsed[0] : parsed;
  const host = record?.Endpoints?.docker?.Host;
  if (!host) throw new Error(`Docker context "${context}" does not declare an endpoint host.`);
  const daemonId = checked(runner, "docker", [
    "--context",
    context,
    "info",
    "--format",
    "{{.ID}}",
  ]).trim();
  if (!daemonId) throw new Error(`Docker context "${context}" did not report a daemon ID.`);
  return digest(["docker-endpoint", host, daemonId]);
}

/**
 * Reads key NAMES from an env file on the target host.
 *
 * The file never leaves the host and no value is captured: a throwaway container
 * mounts it read-only and prints the left-hand sides only. This mirrors the
 * Kubernetes doctor asking `kubectl` for key names rather than Secret contents.
 */
function readEnvFileKeys(
  profile: DockerComposeProfileV1,
  path: string,
  image: string,
  runner: CommandRunner,
): string[] {
  const script = `sed -n 's/^[[:space:]]*\\([A-Z][A-Z0-9_]*\\)=.*/\\1/p' /podokit-env | sort -u`;
  // Read it as the identity that will actually deploy.
  //
  // A container running as root proves only that root can read the file, and
  // `docker compose` on a remote target runs as the SSH user. Checking with the
  // wrong identity is how a doctor passes and the apply then dies on
  // "permission denied" -- which is exactly what happened.
  const destination = sshDestination(profile, runner);
  if (destination) {
    const remote = checked(runner, "ssh", [
      destination,
      `sed -n 's/^[[:space:]]*\\([A-Z][A-Z0-9_]*\\)=.*/\\1/p' ${path} | sort -u`,
    ]);
    return remote
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }
  const output = checked(
    runner,
    "docker",
    dockerArgs(profile, [
      "run",
      "--rm",
      "--network",
      "none",
      // The env file is root-owned and 0600 on purpose, and the application images
      // run as a non-root user. Without this the probe reads nothing and reports
      // every key as missing.
      "--user",
      "0:0",
      "-v",
      `${path}:/podokit-env:ro`,
      "--entrypoint",
      "sh",
      image,
      "-c",
      script,
    ]),
  );
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function writeLedger(
  profile: DockerComposeProfileV1,
  image: string,
  ledger: Ledger,
  runner: CommandRunner,
): void {
  const encoded = Buffer.from(JSON.stringify(ledger)).toString("base64");
  checked(
    runner,
    "docker",
    stateScript(
      profile,
      image,
      `echo ${encoded} | base64 -d > ${LEDGER_PATH}.tmp && mv ${LEDGER_PATH}.tmp ${LEDGER_PATH}`,
    ),
  );
}

/**
 * A fail-closed lock. `set -C` makes the redirect fail if the file exists, which is
 * the atomic create-if-absent this needs; a crashed apply deliberately leaves the
 * lock behind so the interrupted deployment is inspected before anything else runs.
 */
function acquireComposeLock(
  profile: DockerComposeProfileV1,
  image: string,
  holder: string,
  runner: CommandRunner,
): void {
  const result = runner(
    "docker",
    stateScript(profile, image, `set -C; echo ${JSON.stringify(holder)} > ${LOCK_PATH}`),
    { capture: true },
  );
  if (result.status !== 0) {
    const current = runner(
      "docker",
      stateScript(profile, image, `cat ${LOCK_PATH} 2>/dev/null || echo unknown`),
      { capture: true },
    );
    throw new Error(
      `Deployment lock for ${profile.target.project} is held by ${current.stdout.trim() || "another operation"}. ` +
        "Inspect the interrupted deployment before removing it.",
    );
  }
}

function releaseComposeLock(
  profile: DockerComposeProfileV1,
  image: string,
  runner: CommandRunner,
): void {
  runner("docker", stateScript(profile, image, `rm -f ${LOCK_PATH}`), { capture: true });
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
  const manifest = parseJson<ImageManifest>(output, `Image manifest inspection for ${reference}`);
  if (!manifest.digest || !/^sha256:[a-f0-9]{64}$/.test(manifest.digest)) {
    throw new Error(`Unable to resolve immutable digest for image ${reference}.`);
  }
  return `${reference}@${manifest.digest}`;
}

function resolveComposeImages(
  profile: DockerComposeProfileV1,
  release: string,
  runner: CommandRunner,
): ComposeImages {
  const defaults = defaultComposeImages(profile, release);
  return {
    api: resolveImage(defaults.api, runner),
    web: resolveImage(defaults.web, runner),
    postgres: defaults.postgres ? resolveImage(defaults.postgres, runner) : null,
    redis: defaults.redis ? resolveImage(defaults.redis, runner) : null,
    objectStorage: defaults.objectStorage ? resolveImage(defaults.objectStorage, runner) : null,
    objectStorageClient: defaults.objectStorageClient
      ? resolveImage(defaults.objectStorageClient, runner)
      : null,
  };
}

function managedDependencyServices(profile: DockerComposeProfileV1): string[] {
  return [
    ...(profile.dependencies.postgres.mode === "managed" ? [serviceName(profile, "postgres")] : []),
    ...(profile.dependencies.redis.mode === "managed" ? [serviceName(profile, "redis")] : []),
    ...(profile.dependencies.objectStorage.mode === "managed"
      ? [serviceName(profile, "object-storage")]
      : []),
  ];
}

export function doctorComposeDeployment(
  projectRoot: string,
  profileName: string,
  runner: CommandRunner = defaultRunner,
  release?: string,
): ComposeDoctorFinding[] {
  const profile = loadComposeProfile(projectRoot, profileName);
  const findings: ComposeDoctorFinding[] = [];
  const record = (code: string, ok: boolean, message: string): void => {
    findings.push({ code, ok, message });
  };

  try {
    checked(runner, "docker", ["compose", "version", "--short"]);
    record("compose-cli", true, "Docker Compose v2 is available.");
  } catch (error) {
    record("compose-cli", false, `Docker Compose v2 is required: ${(error as Error).message}`);
    return findings;
  }

  try {
    checked(runner, "docker", ["buildx", "version"]);
    record("buildx", true, "Docker Buildx is available for digest resolution.");
  } catch (error) {
    record("buildx", false, `Docker Buildx is required: ${(error as Error).message}`);
  }

  let endpointOk = false;
  try {
    const fingerprint = inspectComposeEndpointFingerprint(profile.target.context, runner);
    endpointOk = fingerprint === profile.target.endpointFingerprint;
    record(
      "endpoint-fingerprint",
      endpointOk,
      endpointOk
        ? `Docker context ${profile.target.context} matches the recorded endpoint fingerprint.`
        : `Docker context ${profile.target.context} does not match the recorded endpoint fingerprint.`,
    );
  } catch (error) {
    record("endpoint-fingerprint", false, `Cannot inspect the Docker context: ${(error as Error).message}`);
  }
  if (!endpointOk) return findings;

  const probe = probeImage(profile, release);
  if (!probe) {
    record(
      "env-files",
      false,
      "Cannot inspect the env files: no managed dependency image to borrow a shell from. Re-run with a release.",
    );
    return findings;
  }
  const envFiles: Array<{ label: string; path: string; requiredKeys: string[] }> = [
    { label: "api", path: profile.secrets.api.path, requiredKeys: profile.secrets.api.requiredKeys },
    ...(profile.secrets.web
      ? [{ label: "web", path: profile.secrets.web.path, requiredKeys: profile.secrets.web.requiredKeys }]
      : []),
    ...(profile.dependencies.postgres.mode === "managed"
      ? [
          {
            label: "postgres",
            path: profile.dependencies.postgres.envFile,
            requiredKeys: profile.dependencies.postgres.requiredKeys,
          },
        ]
      : []),
    ...(profile.dependencies.redis.mode === "managed"
      ? [
          {
            label: "redis",
            path: profile.dependencies.redis.envFile,
            requiredKeys: profile.dependencies.redis.requiredKeys,
          },
        ]
      : []),
    ...(profile.dependencies.objectStorage.mode === "managed"
      ? [
          {
            label: "object-storage",
            path: profile.dependencies.objectStorage.envFile,
            requiredKeys: profile.dependencies.objectStorage.requiredKeys,
          },
        ]
      : []),
  ];

  // The API env file must also carry the connection credentials for every managed
  // dependency, because the application reads them from its own environment.
  const dependencyKeys = [
    ...(profile.dependencies.postgres.mode === "managed"
      ? ["POSTGRES_DB", "POSTGRES_PASSWORD", "POSTGRES_USER"]
      : []),
    ...(profile.dependencies.redis.mode === "managed" ? ["REDIS_PASSWORD"] : []),
    ...(profile.dependencies.objectStorage.mode === "managed"
      ? ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]
      : []),
  ];

  for (const file of envFiles) {
    const required = new Set(
      file.label === "api" ? [...file.requiredKeys, ...dependencyKeys] : file.requiredKeys,
    );
    try {
      const present = new Set(readEnvFileKeys(profile, file.path, probe, runner));
      const missing = [...required].filter((key) => !present.has(key)).sort();
      record(
        `env-file-${file.label}`,
        missing.length === 0,
        missing.length === 0
          ? `${file.path} provides every required key.`
          : `${file.path} is missing required key(s): ${missing.join(", ")}.`,
      );
    } catch (error) {
      record("env-file-" + file.label, false, `Cannot read ${file.path}: ${(error as Error).message}`);
    }
  }

  if (profile.secrets.registryLogin && release) {
    const result = runner(
      "docker",
      dockerArgs(profile, ["run", "--rm", "--entrypoint", "true", probe]),
      { capture: true },
    );
    record(
      "registry-access",
      result.status === 0,
      result.status === 0
        ? "The target daemon can pull from the release registry."
        : "The target daemon cannot pull the release image; run docker login on the target host.",
    );
  }

  return findings;
}

/**
 * What is deployed, without what it happens to be doing right now.
 *
 * `compose ps` reports restart counts, uptime strings and health transitions, and
 * folding those into the plan hash makes the hash change every second something is
 * flapping -- so a plan can never be confirmed on a target that is unhealthy, which
 * is exactly when you most need to deploy. Keep the identity: which services exist
 * and which image each one runs.
 */
function deployedIdentity(psOutput: string): string {
  if (!psOutput.trim()) return "[]";
  const entries = psOutput
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        const entry = JSON.parse(line) as ComposePsEntry;
        return { service: entry.Service ?? entry.Name ?? "", image: entry.Image ?? "" };
      } catch {
        return { service: "", image: "" };
      }
    })
    .sort((left, right) => left.service.localeCompare(right.service) || left.image.localeCompare(right.image));
  return JSON.stringify(entries);
}

function hostStateDigest(
  profile: DockerComposeProfileV1,
  ledger: Ledger,
  psOutput: string,
): string {
  return digest([
    "compose-host-state",
    profile.target.endpointFingerprint,
    JSON.stringify(currentLedgerEntry(ledger)),
    deployedIdentity(psOutput),
  ]);
}

function composePs(profile: DockerComposeProfileV1, runner: CommandRunner): string {
  return composeProjectPs(profile, runner);
}

export function planComposeDeployment(
  projectRoot: string,
  profileName: string,
  release: string,
  runner: CommandRunner = defaultRunner,
): ComposePlan {
  const profile = loadComposeProfile(projectRoot, profileName);
  assertAnyReleaseTag(profile, release);
  const images = resolveComposeImages(profile, release, runner);
  const ledger = readLedger(profile, images.api, runner);
  const current = currentLedgerEntry(ledger);

  // Secret identity is the file's content hash, computed on the host so no value is
  // transferred. A changed env file therefore changes the rollout state, which makes
  // Compose recreate containers that would otherwise keep stale environment values.
  const secretIdentities: Record<string, string> = {};
  const identityTargets: Array<[string, string]> = [
    ["api", profile.secrets.api.path],
    ...(profile.secrets.web ? ([["web", profile.secrets.web.path]] as Array<[string, string]>) : []),
  ];
  const identityDestination = sshDestination(profile, runner);
  for (const [label, path] of identityTargets) {
    if (identityDestination) {
      secretIdentities[label] = checked(runner, "ssh", [
        identityDestination,
        `sha256sum ${path} | cut -d' ' -f1`,
      ]).trim();
      continue;
    }
    const output = checked(
      runner,
      "docker",
      dockerArgs(profile, [
        "run",
        "--rm",
        "--network",
        "none",
        "--user",
        "0:0",
        "-v",
        `${path}:/podokit-env:ro`,
        "--entrypoint",
        "sh",
        images.api,
        "-c",
        "sha256sum /podokit-env | cut -d' ' -f1",
      ]),
    );
    secretIdentities[label] = output.trim();
  }

  const stateDigest = rolloutStateDigest(profile, secretIdentities);
  const runtime = renderComposeDeployment(
    projectRoot,
    profileName,
    profile,
    release,
    images,
    stateDigest,
  );
  const composeDocumentDigest = digest(["compose-document", runtime.composeDocument]);
  const psOutput = composePs(profile, runner);

  const actions: ComposePlanAction[] = [];
  const dependencies = managedDependencyServices(profile);
  let order = 1;
  if (dependencies.length) {
    actions.push({
      order: order++,
      kind: "dependencies",
      description: `Reconcile and wait for ${dependencies.join(", ")}.`,
    });
  }
  actions.push({
    order: order++,
    kind: "migration",
    description: `Run ${(
      profile.migration?.command ??
      toolchainMigrationCommand(readManifest(projectRoot)?.toolchain ?? resolveToolchain())
    ).join(" ")} using ${images.api}.`,
  });
  actions.push({
    order: order++,
    kind: "application",
    description: `Roll out api, web${profile.workloads.worker ? ", worker" : ""} and wait for health.`,
  });
  actions.push({
    order: order++,
    kind: "verification",
    description: `Verify ${profile.verification.checks.length} public check(s) against ${profile.verification.baseUrl}.`,
  });

  const warnings: string[] = [];
  if (current?.release === release) {
    warnings.push(
      `Release ${release} is already the current revision; apply will recreate containers whose definition changed.`,
    );
  }
  warnings.push(
    "The migration runs before the new containers start, so it must be compatible with the release currently serving traffic.",
  );

  const profileDigest = composeProfileDigest(profile);
  const planHash = digest([
    "compose-plan",
    profileName,
    release,
    profileDigest,
    JSON.stringify(images),
    composeDocumentDigest,
    stateDigest,
    hostStateDigest(profile, ledger, psOutput),
  ]);

  return {
    profile: profileName,
    release,
    planHash,
    profileDigest,
    currentRevision: current?.revision ?? null,
    currentRelease: current?.release ?? null,
    hostStateDigest: hostStateDigest(profile, ledger, psOutput),
    rolloutStateDigest: stateDigest,
    composeDocumentDigest,
    target: { ...profile.target },
    images,
    actions,
    warnings,
  };
}

export async function applyComposeDeployment(
  projectRoot: string,
  profileName: string,
  release: string,
  confirm: string,
  runner: CommandRunner = defaultRunner,
  fetcher: typeof fetch = fetch,
): Promise<{ plan: ComposePlan; status: ComposeStatus; verification: ComposeVerificationResult }> {
  const findings = doctorComposeDeployment(projectRoot, profileName, runner, release);
  const failed = findings.filter((finding) => !finding.ok);
  if (failed.length) {
    throw new Error(`Deployment doctor failed: ${failed.map((f) => f.message).join(" ")}`);
  }

  const profile = loadComposeProfile(projectRoot, profileName);

  // Nothing is provisioned before the operator's hash is accepted: planning only
  // reads, so an unapproved apply leaves the target exactly as it found it.
  const preflight = planComposeDeployment(projectRoot, profileName, release, runner);
  if (preflight.planHash !== confirm) {
    throw new Error(
      `Confirmation hash does not match the current plan. Expected ${preflight.planHash}.`,
    );
  }

  // The state volume holds the lock and the ledger, so it has to exist before either
  // is touched. Data volumes are created below and are declared external in the
  // rendered project, so `compose down -v` can never take the database with it.
  checked(runner, "docker", dockerArgs(profile, ["volume", "create", stateVolumeName(profile)]));

  const holder = `${randomUUID()} ${release}`;
  acquireComposeLock(profile, preflight.images.api, holder, runner);
  try {
    const plan = planComposeDeployment(projectRoot, profileName, release, runner);
    if (plan.planHash !== confirm) {
      throw new Error(
        "Target state changed between planning and apply; re-plan and confirm the new hash.",
      );
    }
    const runtime = renderComposeDeployment(
      projectRoot,
      profileName,
      profile,
      release,
      plan.images,
      plan.rolloutStateDigest,
    );

    for (const dependency of [
      profile.dependencies.postgres,
      profile.dependencies.redis,
      profile.dependencies.objectStorage,
    ]) {
      if (dependency.mode === "managed") {
        checked(runner, "docker", dockerArgs(profile, ["volume", "create", dependency.volume]));
      }
    }

    const dependencies = managedDependencyServices(profile);
    if (dependencies.length) {
      runCompose(profile, runtime, "compose", ["up", "-d", "--wait", ...dependencies], runner, false);
    } else {
      // The application network still has to exist before the migration project,
      // which joins it as an external network, can start.
      runCompose(profile, runtime, "compose", ["up", "-d", "--no-start"], runner, false);
    }

    runCompose(profile, runtime, "migration", ["run", "--rm", "--no-deps", "migrate"], runner, false);

    runCompose(profile, runtime, "compose", ["up", "-d", "--wait", "--remove-orphans"], runner, false);

    const ledger = readLedger(profile, plan.images.api, runner);
    ledger.entries.push({
      revision: (currentLedgerEntry(ledger)?.revision ?? 0) + 1,
      release,
      images: plan.images,
      composeDocumentDigest: plan.composeDocumentDigest,
      rolloutStateDigest: plan.rolloutStateDigest,
    });
    ledger.entries = ledger.entries.slice(-LEDGER_DEPTH);
    writeLedger(profile, plan.images.api, ledger, runner);

    const status = getComposeStatus(projectRoot, profileName, runner);
    const verification = await verifyComposeDeployment(projectRoot, profileName, fetcher);
    return { plan, status, verification };
  } finally {
    releaseComposeLock(profile, preflight.images.api, runner);
  }
}

export function getComposeStatus(
  projectRoot: string,
  profileName: string,
  runner: CommandRunner = defaultRunner,
): ComposeStatus {
  const profile = loadComposeProfile(projectRoot, profileName);
  // No render here. This used to build one with a placeholder release purely to have
  // a file path to pass to `compose ps`, on the reasoning that the tag inside it was
  // never resolved -- but on a remote context every compose invocation copied that
  // file to the target first, so reading the status replaced the applied project with
  // one naming an image that does not exist. `compose -p <project> ps` matches on
  // labels and needs no file at all.
  const psOutput = composePs(profile, runner);
  const entries: ComposePsEntry[] = psOutput
    ? psOutput
        .split("\n")
        .filter(Boolean)
        .map((line) => parseJson<ComposePsEntry>(line, "docker compose ps"))
    : [];

  const byService = new Map<string, ComposePsEntry[]>();
  for (const entry of entries) {
    const key = entry.Service ?? entry.Name ?? "unknown";
    byService.set(key, [...(byService.get(key) ?? []), entry]);
  }

  const services: ComposeStatus["services"] = [];
  for (const [name, group] of [...byService.entries()].sort(([l], [r]) => l.localeCompare(r))) {
    let restartCount = 0;
    const images: string[] = [];
    let health = "unknown";
    for (const entry of group) {
      if (!entry.Name) continue;
      const inspected = runner(
        "docker",
        dockerArgs(profile, ["inspect", entry.Name, "--format", "{{json .}}"]),
        { capture: true },
      );
      if (inspected.status !== 0) continue;
      const container = parseJson<ContainerInspect>(inspected.stdout, `docker inspect ${entry.Name}`);
      restartCount += container.RestartCount ?? 0;
      const image = container.Image ?? container.Config?.Image;
      if (image && !images.includes(image)) images.push(image);
      health = container.State?.Health?.Status ?? container.State?.Status ?? health;
    }
    const desiredWorkload =
      name === serviceName(profile, "api")
        ? profile.workloads.api
        : name === serviceName(profile, "web")
          ? profile.workloads.web
          : name === serviceName(profile, "worker")
            ? profile.workloads.worker
            : null;
    services.push({
      name,
      running: group.filter((entry) => entry.State === "running").length,
      desired: desiredWorkload?.replicas ?? group.length,
      images,
      health,
      restartCount,
    });
  }

  const apiImage = services.find((service) => service.name === serviceName(profile, "api"))?.images[0];
  const ledger = apiImage
    ? readLedger(profile, apiImage, runner)
    : ({ schemaVersion: 1, entries: [] } as Ledger);
  const current = currentLedgerEntry(ledger);
  return {
    profile: profileName,
    revision: current?.revision ?? null,
    release: current?.release ?? null,
    services,
    syncDrift: readComposeSyncDrift(projectRoot, profileName, runner),
  };
}

export async function verifyComposeDeployment(
  projectRoot: string,
  profileName: string,
  fetcher: typeof fetch = fetch,
): Promise<ComposeVerificationResult> {
  const profile = loadComposeProfile(projectRoot, profileName);
  const paths: ComposeVerificationResult["paths"] = [];
  for (const check of profile.verification.checks) {
    try {
      const response = await fetcher(new URL(check.path, profile.verification.baseUrl), {
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
      let ok = response.status === check.expectedStatus;
      if (ok && check.expectedJson) {
        const body = (await response.json().catch(() => null)) as unknown;
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

export function planComposeRollback(
  projectRoot: string,
  profileName: string,
  revision: number,
  runner: CommandRunner = defaultRunner,
): ComposePlan {
  const profile = loadComposeProfile(projectRoot, profileName);
  const probe = probeImage(profile);
  if (!probe) {
    throw new Error(
      "Cannot read the release ledger: no managed dependency image to borrow a shell from.",
    );
  }
  const ledger = readLedger(profile, probe, runner);
  const target = ledger.entries.find((entry) => entry.revision === revision);
  if (!target) {
    const known = ledger.entries.map((entry) => entry.revision).join(", ") || "none";
    throw new Error(`Revision ${revision} is not in the release ledger. Known revisions: ${known}.`);
  }
  const runtime = renderComposeDeployment(
    projectRoot,
    profileName,
    profile,
    target.release,
    target.images,
    target.rolloutStateDigest,
  );
  const composeDocumentDigest = digest(["compose-document", runtime.composeDocument]);
  if (composeDocumentDigest !== target.composeDocumentDigest) {
    throw new Error(
      "The profile has changed since that revision was applied, so it cannot be reproduced byte for byte. " +
        "Roll forward with a new release instead.",
    );
  }
  const psOutput = composePs(profile, runner);
  const current = currentLedgerEntry(ledger);
  const profileDigest = composeProfileDigest(profile);
  const planHash = digest([
    "compose-rollback",
    profileName,
    String(revision),
    profileDigest,
    JSON.stringify(target.images),
    composeDocumentDigest,
    hostStateDigest(profile, ledger, psOutput),
  ]);
  return {
    profile: profileName,
    release: target.release,
    planHash,
    profileDigest,
    currentRevision: current?.revision ?? null,
    currentRelease: current?.release ?? null,
    hostStateDigest: hostStateDigest(profile, ledger, psOutput),
    rolloutStateDigest: target.rolloutStateDigest,
    composeDocumentDigest,
    target: { ...profile.target },
    images: target.images,
    actions: [
      {
        order: 1,
        kind: "rollback",
        description: `Restore revision ${revision} (${target.release}) and wait for health.`,
      },
      {
        order: 2,
        kind: "verification",
        description: `Verify ${profile.verification.checks.length} public check(s) against ${profile.verification.baseUrl}.`,
      },
    ],
    warnings: [
      "Rollback does not reverse database migrations. If the older image cannot read the current schema, roll forward instead.",
    ],
  };
}

export async function rollbackComposeDeployment(
  projectRoot: string,
  profileName: string,
  revision: number,
  confirm: string,
  runner: CommandRunner = defaultRunner,
  fetcher: typeof fetch = fetch,
): Promise<{ plan: ComposePlan; status: ComposeStatus; verification: ComposeVerificationResult }> {
  const profile = loadComposeProfile(projectRoot, profileName);
  const preflight = planComposeRollback(projectRoot, profileName, revision, runner);
  if (preflight.planHash !== confirm) {
    throw new Error(
      `Confirmation hash does not match the current rollback plan. Expected ${preflight.planHash}.`,
    );
  }
  const holder = `${randomUUID()} rollback-${revision}`;
  acquireComposeLock(profile, preflight.images.api, holder, runner);
  try {
    const runtime = renderComposeDeployment(
      projectRoot,
      profileName,
      profile,
      preflight.release,
      preflight.images,
      preflight.rolloutStateDigest,
    );
    runCompose(profile, runtime, "compose", ["up", "-d", "--wait", "--remove-orphans"], runner, false);
    const ledger = readLedger(profile, preflight.images.api, runner);
    ledger.entries.push({
      revision: (currentLedgerEntry(ledger)?.revision ?? 0) + 1,
      release: preflight.release,
      images: preflight.images,
      composeDocumentDigest: preflight.composeDocumentDigest,
      rolloutStateDigest: preflight.rolloutStateDigest,
    });
    ledger.entries = ledger.entries.slice(-LEDGER_DEPTH);
    writeLedger(profile, preflight.images.api, ledger, runner);
    const status = getComposeStatus(projectRoot, profileName, runner);
    const verification = await verifyComposeDeployment(projectRoot, profileName, fetcher);
    return { plan: preflight, status, verification };
  } finally {
    releaseComposeLock(profile, preflight.images.api, runner);
  }
}

/** Where the rendered project lands, for callers that want to show it. */
export function composeRuntimeRoot(projectRoot: string, profileName: string): string {
  return join(projectRoot, ".podokit", "runtime", "deploy", profileName);
}
