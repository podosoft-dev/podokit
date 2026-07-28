import type { CommandRunner } from "./dev";
import {
  doctorDeployment,
  getDeploymentStatus,
  planDeployment,
  verifyDeployment,
  type DeploymentDoctorFinding,
  type DeploymentPlan,
  type DeploymentStatus,
  type VerificationResult,
} from "./deploy";
import {
  doctorComposeDeployment,
  getComposeStatus,
  planComposeDeployment,
  verifyComposeDeployment,
  type ComposeDoctorFinding,
  type ComposePlan,
  type ComposeStatus,
  type ComposeVerificationResult,
} from "./deploy-compose";
import { readDeploymentDriver, type DeployDriver } from "./deploy-driver";

/**
 * Driver-agnostic entry points.
 *
 * A caller that already knows which driver it wants can reach for that driver's
 * functions directly. Everything that works from a profile name — the CLI's shared
 * paths, the MCP server — comes through here instead, so adding a driver does not
 * mean adding a parallel tool for every read-only operation.
 */

export function doctorAnyDeployment(
  projectRoot: string,
  profileName: string,
  runner?: CommandRunner,
): { driver: DeployDriver; findings: (DeploymentDoctorFinding | ComposeDoctorFinding)[] } {
  const driver = readDeploymentDriver(projectRoot, profileName);
  const findings =
    driver === "docker-compose"
      ? doctorComposeDeployment(projectRoot, profileName, runner)
      : doctorDeployment(projectRoot, profileName, runner);
  return { driver, findings };
}

export function planAnyDeployment(
  projectRoot: string,
  profileName: string,
  release: string,
  runner?: CommandRunner,
): { driver: DeployDriver; plan: DeploymentPlan | ComposePlan } {
  const driver = readDeploymentDriver(projectRoot, profileName);
  return {
    driver,
    plan:
      driver === "docker-compose"
        ? planComposeDeployment(projectRoot, profileName, release, runner)
        : planDeployment(projectRoot, profileName, release, runner),
  };
}

export function getAnyDeploymentStatus(
  projectRoot: string,
  profileName: string,
  runner?: CommandRunner,
): { driver: DeployDriver; status: DeploymentStatus | ComposeStatus } {
  const driver = readDeploymentDriver(projectRoot, profileName);
  return {
    driver,
    status:
      driver === "docker-compose"
        ? getComposeStatus(projectRoot, profileName, runner)
        : getDeploymentStatus(projectRoot, profileName, runner),
  };
}

export async function verifyAnyDeployment(
  projectRoot: string,
  profileName: string,
  fetcher?: typeof fetch,
): Promise<{ driver: DeployDriver; verification: VerificationResult | ComposeVerificationResult }> {
  const driver = readDeploymentDriver(projectRoot, profileName);
  return {
    driver,
    verification:
      driver === "docker-compose"
        ? await verifyComposeDeployment(projectRoot, profileName, fetcher)
        : await verifyDeployment(projectRoot, profileName, fetcher),
  };
}

/** A one-line, secret-free description of where a profile points. */
export function describeDeploymentTarget(profile: {
  driver: DeployDriver;
  target: Record<string, unknown>;
}): string {
  return profile.driver === "docker-compose"
    ? `driver=docker-compose, context=${String(profile.target.context)}, project=${String(profile.target.project)}`
    : `driver=kubernetes-helm, context=${String(profile.target.context)}, namespace=${String(profile.target.namespace)}, release=${String(profile.target.release)}`;
}
