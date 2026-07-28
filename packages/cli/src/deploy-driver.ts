import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DeployProfileV1, loadDeploymentProfile } from "./deploy-profile";
import { DockerComposeProfileV1, parseComposeProfile } from "./deploy-compose-profile";
import { isRecord, profileDirectory, profilePath } from "./deploy-schema";

/**
 * Driver dispatch.
 *
 * A profile names its own driver, so reading one is a two-step: look at `driver`,
 * then hand the document to that driver's parser. Everything downstream narrows on
 * the same discriminant.
 */

export type AnyDeployProfile = DeployProfileV1 | DockerComposeProfileV1;
export type DeployDriver = AnyDeployProfile["driver"];

export const DEPLOY_DRIVERS: DeployDriver[] = ["kubernetes-helm", "docker-compose"];

export interface AnyDeploymentProfileSummary {
  name: string;
  path: string;
  profile: AnyDeployProfile;
}

function readProfileDocument(projectRoot: string, name: string): unknown {
  const path = profilePath(projectRoot, name);
  if (!existsSync(path)) throw new Error(`Deployment profile "${name}" does not exist at ${path}.`);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Cannot read deployment profile "${name}": ${(error as Error).message}`);
  }
}

/** The declared driver, read without validating the rest of the document. */
export function readDeploymentDriver(projectRoot: string, name: string): DeployDriver {
  const document = readProfileDocument(projectRoot, name);
  if (!isRecord(document)) throw new Error("Deployment profile must be a JSON object.");
  const driver = document.driver;
  if (driver !== "kubernetes-helm" && driver !== "docker-compose") {
    throw new Error(
      `Unsupported deployment driver: ${String(driver)}. Supported drivers: ${DEPLOY_DRIVERS.join(", ")}.`,
    );
  }
  return driver;
}

export function loadAnyDeploymentProfile(projectRoot: string, name: string): AnyDeployProfile {
  return readDeploymentDriver(projectRoot, name) === "docker-compose"
    ? parseComposeProfile(readProfileDocument(projectRoot, name))
    : loadDeploymentProfile(projectRoot, name);
}

export function loadComposeProfile(projectRoot: string, name: string): DockerComposeProfileV1 {
  const profile = loadAnyDeploymentProfile(projectRoot, name);
  if (profile.driver !== "docker-compose") {
    throw new Error(
      `Deployment profile "${name}" uses the ${profile.driver} driver; this command needs docker-compose.`,
    );
  }
  return profile;
}

export function loadKubernetesProfile(projectRoot: string, name: string): DeployProfileV1 {
  const profile = loadAnyDeploymentProfile(projectRoot, name);
  if (profile.driver !== "kubernetes-helm") {
    throw new Error(
      `Deployment profile "${name}" uses the ${profile.driver} driver; this command needs kubernetes-helm.`,
    );
  }
  return profile;
}

export function listAnyDeploymentProfiles(projectRoot: string): AnyDeploymentProfileSummary[] {
  const directory = profileDirectory(projectRoot);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => {
      const name = entry.slice(0, -5);
      return {
        name,
        path: join(directory, entry),
        profile: loadAnyDeploymentProfile(projectRoot, name),
      };
    });
}

/** The release tag gate, which both drivers enforce identically. */
export function assertAnyReleaseTag(profile: AnyDeployProfile, release: string): void {
  if (release === "latest" || !new RegExp(profile.release.tagPattern).test(release)) {
    throw new Error(
      `Release "${release}" does not match deployment tag pattern ${profile.release.tagPattern}.`,
    );
  }
}
