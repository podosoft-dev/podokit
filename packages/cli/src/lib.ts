// Library entry point: the reusable functions behind the `podo` CLI, for other
// packages (e.g. @podosoft/podokit-mcp) to call without spawning the binary.
import { join } from "node:path";

export { create } from "./create";
export type { CreateOptions, CreateResult } from "./create";
export {
  applyProviderChange,
  listProviders,
  planProviderChange,
  providerSource,
  PROVIDERS_SOURCE,
} from "./provider";
export type { ProviderChangePlan, ProviderListItem } from "./provider";
export { TEMPLATES, DEFAULT_TEMPLATE, TEMPLATE_NAMES, isKnownTemplate } from "./templates";
export type { TemplateInfo } from "./templates";
export { listModules, addModule } from "./add";
export type {
  ModuleManifest,
  ModuleMigration,
  ModulePathMove,
  ModuleTextReplacement,
  AddOptions,
  AddResult,
} from "./add";
export { status, diff, doctor, SUPPORTED_FRAMEWORKS } from "./inspect";
export type { StatusReport, DoctorFinding } from "./inspect";
export { planUpdate, summarize } from "./update";
export type { UpdatePlan, FileChange } from "./update";
export { readDevConfig, renderRoute, renderRuntimeCompose, resolveDevRuntime, runDevCommand } from "./dev";
export type { CommandRunner, DevConfig, DevRuntime } from "./dev";
export {
  applyDeployment,
  doctorDeployment,
  getDeploymentStatus,
  inspectClusterFingerprint,
  planDeployment,
  planRollback,
  rollbackDeployment,
  verifyDeployment,
} from "./deploy";
export type {
  DeploymentDoctorFinding,
  DeploymentPlan,
  DeploymentPlanAction,
  DeploymentStatus,
  VerificationResult,
} from "./deploy";
export {
  assertReleaseTag,
  deploymentProfileDigest,
  initializeDeploymentProfile,
  listDeploymentProfiles,
  loadDeploymentProfile,
} from "./deploy-profile";
export type {
  DependencyMode,
  DeployProfileV1,
  DeploymentProfileSummary,
  InitializeDeploymentProfileOptions,
  ObjectStorageDependencyProfile,
  RedisDependencyProfile,
  ResourceProfile,
  StatefulDependencyProfile,
  WorkloadProfile,
} from "./deploy-profile";
export { renderDeployment } from "./deploy-render";
export type { DeploymentRuntime } from "./deploy-render";
export {
  DEPLOY_DRIVERS,
  assertAnyReleaseTag,
  listAnyDeploymentProfiles,
  loadAnyDeploymentProfile,
  loadComposeProfile,
  loadKubernetesProfile,
  readDeploymentDriver,
} from "./deploy-driver";
export type { AnyDeployProfile, DeployDriver } from "./deploy-driver";
export { initializeComposeProfile, parseComposeProfile } from "./deploy-compose-profile";
export type { DockerComposeProfileV1 } from "./deploy-compose-profile";
export { renderComposeDeployment } from "./deploy-compose-render";
export type { ComposeRuntime } from "./deploy-compose-render";
export {
  applyComposeDeployment,
  doctorComposeDeployment,
  getComposeStatus,
  inspectComposeEndpointFingerprint,
  planComposeDeployment,
  planComposeRollback,
  rollbackComposeDeployment,
  verifyComposeDeployment,
} from "./deploy-compose";
export type { ComposePlan, ComposeStatus } from "./deploy-compose";
export {
  describeDeploymentTarget,
  doctorAnyDeployment,
  getAnyDeploymentStatus,
  planAnyDeployment,
  verifyAnyDeployment,
} from "./deploy-dispatch";

/** Absolute path to the templates bundled in this installed package. */
export function builtinTemplatesDir(): string {
  return join(__dirname, "templates");
}

/** Absolute path to the modules bundled in this installed package. */
export function builtinModulesDir(): string {
  return join(__dirname, "templates", "modules");
}
