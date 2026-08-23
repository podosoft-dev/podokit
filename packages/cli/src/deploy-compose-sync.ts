import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandRunner } from "./dev";
import {
  checked,
  composeLockHolder,
  currentLedgerEntry,
  defaultRunner,
  dockerArgs,
  parseJson,
  probeImage,
  readLedger,
  runCompose,
} from "./deploy-compose-exec";
import type { DockerComposeProfileV1 } from "./deploy-compose-profile";
import { renderComposeDeployment, serviceName } from "./deploy-compose-render";
import { loadComposeProfile } from "./deploy-driver";
import { readManifest } from "./lockfile";

/**
 * Development-time artifact sync for the docker-compose driver.
 *
 * `podo deploy apply` replaces containers with a new image, which is the only way a
 * release reaches users. That round trip has to build for the target's architecture,
 * push to a registry, and roll out -- minutes, every time, and most of it is spent
 * rebuilding dependencies that did not change. While *developing against* a
 * deployment, the thing that actually changed is a few megabytes of compiled output.
 *
 * So this copies that output into the containers that are already running and
 * restarts them. It is deliberately NOT a release:
 *
 * - The image tag does not change, so the deployment now runs code its tag does not
 *   describe. A marker file records that, and `podo deploy status` reports it.
 * - Nothing is pushed anywhere, so nothing is reproducible from it.
 * - The next `apply` (or any container recreate) discards it, because container
 *   writable layers do not survive recreation. That is the property that makes this
 *   safe rather than a parallel deployment path: the drift heals itself.
 *
 * It refuses rather than warns whenever the copy would produce a container that
 * cannot be trusted -- see the guards below.
 */

export type ComposeSyncRole = "api" | "web" | "worker";

export interface ComposeSyncArtifact {
  /** Project-relative source path. */
  source: string;
  /** Absolute path inside the container. */
  destination: string;
  kind: "directory" | "file";
  roles: ComposeSyncRole[];
}

export interface ComposeSyncTarget {
  role: ComposeSyncRole;
  service: string;
  container: string;
  /** The image's configured user, so copied files can be given back to it. */
  user: string | null;
}

export interface ComposeSyncPlan {
  profile: string;
  project: string;
  artifacts: ComposeSyncArtifact[];
  excluded: string[];
  targets: ComposeSyncTarget[];
  warnings: string[];
}

export interface ComposeSyncMarker {
  syncedAt: string;
  profile: string;
  artifacts: string[];
  note: string;
}

export interface ComposeSyncDrift {
  container: string;
  marker: ComposeSyncMarker;
}

export interface ComposeSyncResult {
  plan: ComposeSyncPlan;
  copied: Array<{ container: string; source: string; destination: string }>;
  restarted: string[];
  marker: ComposeSyncMarker;
}

export interface ComposeSyncOptions {
  /** Build the artifacts before copying them, in the order the images build them. */
  build?: boolean;
  /** Empty each destination before copying, so deleted files do not linger. */
  clean?: boolean;
  /** Injected for tests; the marker records when the sync happened. */
  now?: () => Date;
  /** How long to wait for a restarted container to report healthy. */
  healthTimeoutMs?: number;
}

interface ContainerInspectUser {
  Config?: { User?: string };
  State?: { Status?: string; Health?: { Status?: string } };
}

interface PackageManifest {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/** Where the marker lands. `/app` is the image's root for every generated service. */
const MARKER_PATH = "/app/.podokit-sync.json";
const MARKER_NOTE =
  "Locally built artifacts were copied into this container. It is not running the code its image tag describes. Recreate the container to restore the image.";
const DEFAULT_HEALTH_TIMEOUT_MS = 120_000;
const HEALTH_POLL_INTERVAL_MS = 2_000;

/**
 * What the images ship outside their dependency tree.
 *
 * Every entry mirrors a `COPY --from=build` line in the generated Dockerfiles, which
 * is what makes the copy equivalent to a rebuild for code-only changes. Two entries
 * exist for a reason worth keeping:
 *
 * - `apps/web/server.js` and `apps/web/src/lib/server` ship as SOURCE, outside the
 *   bundle, because the entry point has to run before the adapter does. Syncing only
 *   `build/` would leave a stale entry running new routes.
 * - `packages/*` are copied as real directories rather than the symlinks npm leaves
 *   behind, so their `dist/` is a separate destination from the apps'.
 *
 * `node_modules` is deliberately absent: the image installs a production-only,
 * workspace-scoped tree for its own platform, and a developer's tree is neither.
 */
export function composeSyncArtifacts(projectRoot: string): ComposeSyncArtifact[] {
  const artifacts: ComposeSyncArtifact[] = [];
  const push = (
    source: string,
    destination: string,
    kind: "directory" | "file",
    roles: ComposeSyncRole[],
  ): void => {
    if (existsSync(join(projectRoot, source))) {
      artifacts.push({ source, destination, kind, roles });
    }
  };

  const packagesDir = join(projectRoot, "packages");
  if (existsSync(packagesDir)) {
    for (const entry of readdirSync(packagesDir).sort()) {
      if (!existsSync(join(packagesDir, entry, "package.json"))) continue;
      push(
        `packages/${entry}/dist`,
        `/app/packages/${entry}/dist`,
        "directory",
        ["api", "web", "worker"],
      );
    }
  }

  push("apps/api/dist", "/app/apps/api/dist", "directory", ["api", "worker"]);
  push("apps/api/scripts", "/app/apps/api/scripts", "directory", ["api", "worker"]);
  push("apps/web/build", "/app/apps/web/build", "directory", ["web"]);
  push("apps/web/server.js", "/app/apps/web/server.js", "file", ["web"]);
  push("apps/web/src/lib/server", "/app/apps/web/src/lib/server", "directory", ["web"]);
  return artifacts;
}

/** The excludes that fall inside one artifact, as paths relative to it. */
export function excludesWithin(artifact: ComposeSyncArtifact, excludes: string[]): string[] {
  const prefix = `${artifact.source}/`;
  return excludes
    .filter((entry) => entry.startsWith(prefix))
    .map((entry) => entry.slice(prefix.length));
}

/**
 * Whether the image's dependency tree can still run this code.
 *
 * Only the runtime dependency sets matter: `npm ci --omit=dev` installed what these
 * declare and nothing else, so a change to any of them means the container is
 * missing a package the new code imports -- a failure that surfaces as a crash loop
 * after the restart rather than as a copy error. `devDependencies` are absent from
 * the image by design and a `version` bump changes nothing at runtime, so neither
 * takes part.
 */
export function runtimeDependenciesOf(manifest: PackageManifest): string {
  return JSON.stringify({
    dependencies: manifest.dependencies ?? {},
    optionalDependencies: manifest.optionalDependencies ?? {},
    peerDependencies: manifest.peerDependencies ?? {},
  });
}

/** The manifests whose runtime dependencies a role's container was built from. */
function manifestPathsFor(projectRoot: string, role: ComposeSyncRole): Array<[string, string]> {
  const app = role === "web" ? "web" : "api";
  const pairs: Array<[string, string]> = [
    [join(projectRoot, "apps", app, "package.json"), `/app/apps/${app}/package.json`],
  ];
  const packagesDir = join(projectRoot, "packages");
  if (existsSync(packagesDir)) {
    for (const entry of readdirSync(packagesDir).sort()) {
      const local = join(packagesDir, entry, "package.json");
      if (existsSync(local)) pairs.push([local, `/app/packages/${entry}/package.json`]);
    }
  }
  return pairs;
}

function inspectContainer(
  profile: DockerComposeProfileV1,
  container: string,
  runner: CommandRunner,
): ContainerInspectUser {
  const output = checked(
    runner,
    "docker",
    dockerArgs(profile, ["inspect", container, "--format", "{{json .}}"]),
  );
  return parseJson<ContainerInspectUser>(output, `docker inspect ${container}`);
}

/**
 * The running container for a Compose service, found by label rather than by name.
 *
 * Compose derives container names from the project, the service and an index, and a
 * project whose name is also the service prefix produces names that look duplicated.
 * Reconstructing that string is guesswork; the labels are what Compose itself
 * matches on.
 */
function findContainer(
  profile: DockerComposeProfileV1,
  service: string,
  runner: CommandRunner,
): string | null {
  const output = checked(
    runner,
    "docker",
    dockerArgs(profile, [
      "ps",
      "--filter",
      `label=com.docker.compose.project=${profile.target.project}`,
      "--filter",
      `label=com.docker.compose.service=${service}`,
      "--format",
      "{{.Names}}",
    ]),
  );
  const names = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return names[0] ?? null;
}

function rolesOf(profile: DockerComposeProfileV1): ComposeSyncRole[] {
  return profile.workloads.worker ? ["api", "web", "worker"] : ["api", "web"];
}

export function planComposeSync(
  projectRoot: string,
  profileName: string,
  runner: CommandRunner = defaultRunner,
): ComposeSyncPlan {
  const profile = loadComposeProfile(projectRoot, profileName);
  const excluded = profile.sync?.exclude ?? [];
  const artifacts = composeSyncArtifacts(projectRoot);
  const warnings: string[] = [];

  const targets: ComposeSyncTarget[] = [];
  for (const role of rolesOf(profile)) {
    const service = serviceName(profile, role);
    const container = findContainer(profile, service, runner);
    if (!container) {
      warnings.push(`Service ${service} has no running container; it is skipped.`);
      continue;
    }
    const inspected = inspectContainer(profile, container, runner);
    targets.push({ role, service, container, user: inspected.Config?.User?.trim() || null });
  }

  warnings.push(
    "Restarting a container drops every connection it is serving, including WebSocket sessions.",
  );
  warnings.push(
    "This does not run migrations. A change that needs one belongs in a release, not a sync.",
  );
  return {
    profile: profileName,
    project: profile.target.project,
    artifacts,
    excluded,
    targets,
    warnings,
  };
}

/**
 * Build what the images build, in the order the images build it.
 *
 * Not the root `build` script: npm runs workspaces in the order the root manifest
 * lists them, and `apps/*` is conventionally listed before `packages/*`. An app then
 * compiles against a workspace package's previous output, or against none at all.
 * The Dockerfiles build every package first for exactly this reason.
 */
function buildArtifacts(projectRoot: string, runner: CommandRunner): void {
  const manifest = readManifest(projectRoot);
  const pm = manifest?.toolchain.packageManager ?? "npm";
  const packagesDir = join(projectRoot, "packages");
  if (existsSync(packagesDir)) {
    for (const entry of readdirSync(packagesDir).sort()) {
      if (!existsSync(join(packagesDir, entry, "package.json"))) continue;
      checked(
        runner,
        pm,
        pm === "bun"
          ? ["run", "--cwd", `packages/${entry}`, "--if-present", "build"]
          : ["run", "build", "--if-present", "--workspace", `packages/${entry}`],
        false,
      );
    }
  }
  for (const app of ["api", "web"]) {
    if (!existsSync(join(projectRoot, "apps", app, "package.json"))) continue;
    checked(
      runner,
      pm,
      pm === "bun"
        ? ["run", "--cwd", `apps/${app}`, "--if-present", "build"]
        : ["run", "build", "--if-present", "--workspace", `apps/${app}`],
      false,
    );
  }
}

function assertNoManifestDrift(
  projectRoot: string,
  profile: DockerComposeProfileV1,
  targets: ComposeSyncTarget[],
  runner: CommandRunner,
): void {
  const drifted: string[] = [];
  for (const target of targets) {
    for (const [local, inContainer] of manifestPathsFor(projectRoot, target.role)) {
      const result = runner(
        "docker",
        dockerArgs(profile, ["exec", target.container, "cat", inContainer]),
        { capture: true },
      );
      if (result.status !== 0) {
        drifted.push(`${target.container}:${inContainer} could not be read`);
        continue;
      }
      const deployed = runtimeDependenciesOf(
        parseJson<PackageManifest>(result.stdout, `${target.container}:${inContainer}`),
      );
      const current = runtimeDependenciesOf(
        JSON.parse(readFileSync(local, "utf8")) as PackageManifest,
      );
      if (deployed !== current) drifted.push(`${inContainer} (in ${target.container})`);
    }
  }
  if (drifted.length) {
    throw new Error(
      "Runtime dependencies have changed since these containers were built, so their node_modules " +
        `cannot run this code: ${drifted.join(", ")}. Build and deploy a release instead.`,
    );
  }
}

/**
 * A copy of one artifact with the excluded paths removed.
 *
 * `docker cp` has no exclude, and it merges rather than replaces -- so filtering has
 * to happen before the copy. Staging costs one local copy of a few megabytes and
 * keeps the rule in one place.
 */
function stageArtifact(
  projectRoot: string,
  artifact: ComposeSyncArtifact,
  excludes: string[],
): { path: string; cleanup: () => void } {
  const source = join(projectRoot, artifact.source);
  const within = excludesWithin(artifact, excludes);
  if (artifact.kind === "file" || within.length === 0) {
    return { path: source, cleanup: () => undefined };
  }
  const staging = mkdtempSync(join(tmpdir(), "podokit-sync-"));
  const staged = join(staging, "artifact");
  cpSync(source, staged, { recursive: true });
  for (const relative of within) rmSync(join(staged, relative), { recursive: true, force: true });
  return { path: staged, cleanup: () => rmSync(staging, { recursive: true, force: true }) };
}

async function waitForContainer(
  profile: DockerComposeProfileV1,
  container: string,
  timeoutMs: number,
  runner: CommandRunner,
): Promise<{ state: string; ok: boolean }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const inspected = inspectContainer(profile, container, runner);
    const health = inspected.State?.Health?.Status;
    const status = inspected.State?.Status ?? "unknown";
    // A container without a HEALTHCHECK reports no health at all, and waiting for a
    // status it will never publish would hang every sync on such an image.
    if (health === "healthy") return { state: health, ok: true };
    if (!health && status === "running") return { state: status, ok: true };
    if (health === "unhealthy") return { state: health, ok: false };
    if (Date.now() >= deadline) return { state: health ?? status, ok: false };
    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS));
  }
}

export async function syncComposeDeployment(
  projectRoot: string,
  profileName: string,
  options: ComposeSyncOptions = {},
  runner: CommandRunner = defaultRunner,
): Promise<ComposeSyncResult> {
  const profile = loadComposeProfile(projectRoot, profileName);
  const holder = composeLockHolder(profile, runner);
  if (holder) {
    throw new Error(
      `Deployment lock for ${profile.target.project} is held by ${holder}. A release is in progress; wait for it to finish.`,
    );
  }

  if (options.build) buildArtifacts(projectRoot, runner);

  const plan = planComposeSync(projectRoot, profileName, runner);
  if (!plan.targets.length) {
    throw new Error(
      `No running container found for Compose project ${profile.target.project}. Deploy a release before syncing into it.`,
    );
  }
  if (!plan.artifacts.length) {
    throw new Error(
      "No build output to sync. Build the project first, or pass --build to build it here.",
    );
  }
  if (options.clean) {
    const conflicting = plan.artifacts.filter(
      (artifact) => excludesWithin(artifact, plan.excluded).length > 0,
    );
    if (conflicting.length) {
      throw new Error(
        `--clean cannot be used while ${conflicting.map((a) => a.source).join(", ")} contains an excluded path: ` +
          "emptying the destination would delete artifacts this machine cannot rebuild.",
      );
    }
  }

  assertNoManifestDrift(projectRoot, profile, plan.targets, runner);

  const copied: ComposeSyncResult["copied"] = [];
  for (const artifact of plan.artifacts) {
    const staged = stageArtifact(projectRoot, artifact, plan.excluded);
    try {
      for (const target of plan.targets) {
        if (!artifact.roles.includes(target.role)) continue;
        if (options.clean && artifact.kind === "directory") {
          checked(
            runner,
            "docker",
            dockerArgs(profile, [
              "exec",
              "--user",
              "0:0",
              target.container,
              "sh",
              "-c",
              `rm -rf ${artifact.destination}/* ${artifact.destination}/.[!.]*  2>/dev/null || true`,
            ]),
          );
        }
        // `<dir>/.` copies the CONTENTS into an existing directory; without it the
        // directory would be nested one level deeper on every sync.
        const source = artifact.kind === "directory" ? `${staged.path}/.` : staged.path;
        checked(
          runner,
          "docker",
          dockerArgs(profile, ["cp", source, `${target.container}:${artifact.destination}`]),
        );
        // `docker cp` without --archive gives the files to the daemon's root, and
        // these images run as an unprivileged user. Readable is not enough for a
        // directory the application also has to traverse.
        if (target.user) {
          checked(
            runner,
            "docker",
            dockerArgs(profile, [
              "exec",
              "--user",
              "0:0",
              target.container,
              "chown",
              "-R",
              target.user,
              artifact.destination,
            ]),
          );
        }
        copied.push({
          container: target.container,
          source: artifact.source,
          destination: artifact.destination,
        });
      }
    } finally {
      staged.cleanup();
    }
  }

  const now = options.now ?? ((): Date => new Date());
  const marker: ComposeSyncMarker = {
    syncedAt: now().toISOString(),
    profile: profileName,
    artifacts: plan.artifacts.map((artifact) => artifact.source),
    note: MARKER_NOTE,
  };
  const markerDir = mkdtempSync(join(tmpdir(), "podokit-sync-marker-"));
  const markerFile = join(markerDir, "marker.json");
  writeFileSync(markerFile, `${JSON.stringify(marker, null, 2)}\n`);
  try {
    for (const target of plan.targets) {
      checked(
        runner,
        "docker",
        dockerArgs(profile, ["cp", markerFile, `${target.container}:${MARKER_PATH}`]),
      );
    }
  } finally {
    rmSync(markerDir, { recursive: true, force: true });
  }

  const restarted: string[] = [];
  for (const target of plan.targets) {
    checked(runner, "docker", dockerArgs(profile, ["restart", target.container]));
    restarted.push(target.container);
  }
  // A sync that leaves a container unable to come back is a failed sync, and saying
  // so is the whole value of waiting: the copy already happened, so the operator has
  // to know the deployment is now serving from artifacts that do not work.
  const unhealthy: string[] = [];
  for (const target of plan.targets) {
    const health = await waitForContainer(
      profile,
      target.container,
      options.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS,
      runner,
    );
    if (!health.ok) unhealthy.push(`${target.container} (${health.state})`);
  }
  if (unhealthy.length) {
    throw new Error(
      `Restarted container(s) did not become healthy: ${unhealthy.join(", ")}. ` +
        "The synced artifacts are still in place; podo deploy sync --revert restores the image.",
    );
  }

  return { plan, copied, restarted, marker };
}

/**
 * Which containers are running synced artifacts rather than their image's.
 *
 * Reporting-only, so it never throws: `podo deploy status` folds this in, and a
 * target that cannot answer right now is a reason to report less, not a reason for
 * status to fail. An empty result therefore means "no drift found", which is also
 * what an unreachable target produces -- the services list beside it already shows
 * that case for what it is.
 */
export function readComposeSyncDrift(
  projectRoot: string,
  profileName: string,
  runner: CommandRunner = defaultRunner,
): ComposeSyncDrift[] {
  const profile = loadComposeProfile(projectRoot, profileName);
  const drift: ComposeSyncDrift[] = [];
  for (const role of rolesOf(profile)) {
    try {
      const container = findContainer(profile, serviceName(profile, role), runner);
      if (!container) continue;
      const result = runner("docker", dockerArgs(profile, ["exec", container, "cat", MARKER_PATH]), {
        capture: true,
      });
      if (result.status !== 0 || !result.stdout.trim()) continue;
      drift.push({
        container,
        marker: parseJson<ComposeSyncMarker>(result.stdout, `${container}:${MARKER_PATH}`),
      });
    } catch {
      continue;
    }
  }
  return drift;
}

/**
 * Put the deployment back on its image.
 *
 * The release to restore comes from the ledger, and the project is rendered from
 * that entry's own release, images and rollout state -- the same way a rollback
 * reproduces a revision.
 *
 * ⚠ Not from the Compose file sitting on the target, which was the first attempt.
 * That file is written by whichever command last ran a compose mutation, and one of
 * them renders a placeholder release to obtain a file path. The revert then tried to
 * pull an image tag that never existed and refused to recreate anything. Measured
 * against a live deployment; the read path was fixed at the same time so a status
 * call can no longer overwrite the target's project.
 */
export async function revertComposeSync(
  projectRoot: string,
  profileName: string,
  runner: CommandRunner = defaultRunner,
): Promise<{ services: string[]; project: string; release: string }> {
  const profile = loadComposeProfile(projectRoot, profileName);
  const probe = probeImage(profile);
  if (!probe) {
    throw new Error(
      "Cannot read the release ledger: no managed dependency image to borrow a shell from.",
    );
  }
  const current = currentLedgerEntry(readLedger(profile, probe, runner));
  if (!current) {
    throw new Error(
      "No release has been applied to this deployment, so there is no image state to restore.",
    );
  }
  const runtime = renderComposeDeployment(
    projectRoot,
    profileName,
    profile,
    current.release,
    current.images,
    current.rolloutStateDigest,
  );
  const services = rolesOf(profile).map((role) => serviceName(profile, role));
  runCompose(
    profile,
    runtime,
    "compose",
    ["up", "-d", "--force-recreate", "--wait", ...services],
    runner,
    false,
  );
  return { services, project: profile.target.project, release: current.release };
}
