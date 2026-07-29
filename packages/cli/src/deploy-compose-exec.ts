import { spawnSync } from "node:child_process";
import type { CommandRunner } from "./dev";
import type { DockerComposeProfileV1 } from "./deploy-compose-profile";
import type { ComposeImages, ComposeRuntime } from "./deploy-compose-render";

/**
 * The primitives every docker-compose driver action runs commands through.
 *
 * They live apart from the driver because more than one action needs them and
 * because two of them encode a rule that is easy to get wrong: which machine a
 * command has to run on. See `sshDestination` below.
 */

export function defaultRunner(
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

export function checked(
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

export function parseJson<T>(value: string, description: string): T {
  if (!value.trim()) throw new Error(`${description} returned empty JSON.`);
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(
      `${description} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function dockerArgs(profile: DockerComposeProfileV1, args: string[]): string[] {
  return ["--context", profile.target.context, ...args];
}

/**
 * The SSH destination behind a `ssh://` Docker context, or null for a local one.
 *
 * This matters more than it looks. `docker compose` resolves `env_file` paths and
 * expands `${VAR}` **where the CLI runs**, not where the daemon runs. Pointed at a
 * remote context from a laptop, it looks for the host's secret files on the laptop,
 * fails to find them, and interpolates every referenced variable to an empty string
 * -- which is how a deployment silently comes up with a blank database password.
 *
 * So the Compose file is executed on the target instead: the whole point of keeping
 * credentials in files on that host is that nothing else ever reads them.
 */
export function sshDestination(
  profile: DockerComposeProfileV1,
  runner: CommandRunner,
): string | null {
  const output = runner(
    "docker",
    ["context", "inspect", profile.target.context, "--format", "{{.Endpoints.docker.Host}}"],
    { capture: true },
  );
  if (output.status !== 0) return null;
  const host = output.stdout.trim();
  return host.startsWith("ssh://") ? host.slice("ssh://".length) : null;
}

/** Where the rendered project lives on the target when the context is remote. */
export function remoteProjectDirectory(profile: DockerComposeProfileV1): string {
  return `.local/share/podokit/${profile.target.project}`;
}

/**
 * Run `docker compose` where the Compose file's own references resolve.
 *
 * Local context: here. Remote context: on the target, after copying the rendered
 * file across -- because `env_file` paths and `${...}` expansion are resolved by
 * whoever runs compose, not by the daemon it talks to.
 *
 * ⚠ This OVERWRITES the project file on the target, so it is for mutations only.
 * A read-only query must never come through here: `podo deploy status` renders with
 * a placeholder release to get a file path, and routing its `ps` through this
 * replaced the applied project on the target with one naming an image tag that does
 * not exist. Nothing failed at the time -- the next `compose up` on that host did,
 * with "artifact ...:v0.0.0 not found", long after the status call that caused it.
 * Read-only queries use `composeProjectPs` below, which needs no file at all.
 */
export function runCompose(
  profile: DockerComposeProfileV1,
  runtime: Pick<ComposeRuntime, "composeFile" | "migrationFile">,
  file: "compose" | "migration",
  args: string[],
  runner: CommandRunner,
  capture: boolean,
): string {
  const localFile = file === "compose" ? runtime.composeFile : runtime.migrationFile;
  const destination = sshDestination(profile, runner);
  if (!destination) {
    return checked(
      runner,
      "docker",
      dockerArgs(profile, ["compose", "-f", localFile, ...args]),
      capture,
    );
  }
  const directory = remoteProjectDirectory(profile);
  const remoteFile = `${directory}/${file === "compose" ? "compose.yaml" : "compose.migrate.yaml"}`;
  checked(runner, "ssh", [destination, `mkdir -p ${directory}`], true);
  checked(runner, "scp", ["-q", localFile, `${destination}:${remoteFile}`], true);
  return checked(
    runner,
    "ssh",
    [destination, ["docker", "compose", "-f", remoteFile, ...args].join(" ")],
    capture,
  );
}

/**
 * What the project is running, asked by project name rather than by file.
 *
 * Compose finds a project's containers from their labels, so this needs neither a
 * rendered file nor a release tag -- and therefore cannot disturb the target. It
 * also runs against the daemon through the context, so there is nothing here for
 * `env_file` resolution to get wrong.
 */
export function composeProjectPs(profile: DockerComposeProfileV1, runner: CommandRunner): string {
  const result = runner(
    "docker",
    dockerArgs(profile, ["compose", "-p", profile.target.project, "ps", "--format", "json"]),
    { capture: true },
  );
  return result.status === 0 ? result.stdout.trim() : "";
}

export const STATE_MOUNT = "/podokit-state";
export const LOCK_PATH = `${STATE_MOUNT}/deploy.lock`;
export const LEDGER_PATH = `${STATE_MOUNT}/releases.json`;

export interface LedgerEntry {
  revision: number;
  release: string;
  images: ComposeImages;
  composeDocumentDigest: string;
  rolloutStateDigest: string;
}

export interface Ledger {
  schemaVersion: 1;
  entries: LedgerEntry[];
}

export function currentLedgerEntry(ledger: Ledger): LedgerEntry | null {
  return ledger.entries.length ? (ledger.entries[ledger.entries.length - 1] ?? null) : null;
}

export function readLedger(
  profile: DockerComposeProfileV1,
  image: string,
  runner: CommandRunner,
): Ledger {
  const result = runner(
    "docker",
    stateScript(profile, image, `cat ${LEDGER_PATH} 2>/dev/null || echo ""`),
    { capture: true },
  );
  const body = result.status === 0 ? result.stdout.trim() : "";
  if (!body) return { schemaVersion: 1, entries: [] };
  const parsed = parseJson<Ledger>(body, "Release ledger");
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)) {
    throw new Error("Release ledger is not a supported schema version 1 document.");
  }
  return parsed;
}

export function stateVolumeName(profile: DockerComposeProfileV1): string {
  return `${profile.target.project}-podokit-state`;
}

/**
 * An image the target can pull, for the checks that need a shell on the host.
 *
 * The release image is the right one whenever a release is known -- it is the image
 * about to run, so proving it pulls is part of the check. Without one (a bare
 * `podo deploy doctor` before anything is published) fall back to a managed
 * dependency image, which the profile already pins by digest and the deployment
 * needs anyway. Fabricating a release tag would ask the registry for something that
 * can never exist.
 */
export function probeImage(profile: DockerComposeProfileV1, release?: string): string | null {
  if (release) return `${profile.release.apiRepository}:${release}`;
  for (const dependency of [
    profile.dependencies.postgres,
    profile.dependencies.redis,
    profile.dependencies.objectStorage,
  ]) {
    if (dependency.mode === "managed") return dependency.image;
  }
  return null;
}

export function stateScript(
  profile: DockerComposeProfileV1,
  image: string,
  script: string,
): string[] {
  return dockerArgs(profile, [
    "run",
    "--rm",
    "--network",
    "none",
    // The state volume is root-owned; the application images are not.
    "--user",
    "0:0",
    "-v",
    `${stateVolumeName(profile)}:${STATE_MOUNT}`,
    "--entrypoint",
    "sh",
    image,
    "-c",
    script,
  ]);
}

/**
 * Who holds the deployment lock, for actions that must not run during an apply.
 *
 * Returns null both when nothing holds it and when the lock cannot be read at all --
 * a project with no managed dependency has no image to borrow a shell from, and
 * refusing every other action because of that would be worse than not checking.
 */
export function composeLockHolder(
  profile: DockerComposeProfileV1,
  runner: CommandRunner,
): string | null {
  const probe = probeImage(profile);
  if (!probe) return null;
  const result = runner(
    "docker",
    stateScript(profile, probe, `cat ${LOCK_PATH} 2>/dev/null || true`),
    { capture: true },
  );
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}
