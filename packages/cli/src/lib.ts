// Library entry point: the reusable functions behind the `podo` CLI, for other
// packages (e.g. @podosoft/podokit-mcp) to call without spawning the binary.
import { join } from "node:path";

export { create } from "./create";
export type { CreateOptions, CreateResult } from "./create";
export { TEMPLATES, DEFAULT_TEMPLATE, TEMPLATE_NAMES, isKnownTemplate } from "./templates";
export type { TemplateInfo } from "./templates";
export { listModules, addModule } from "./add";
export type { ModuleManifest, AddOptions, AddResult } from "./add";
export { status, diff, doctor, SUPPORTED_FRAMEWORKS } from "./inspect";
export type { StatusReport, DoctorFinding } from "./inspect";
export { planUpdate, summarize } from "./update";
export type { UpdatePlan, FileChange } from "./update";
export { readDevConfig, renderRoute, renderRuntimeCompose, resolveDevRuntime, runDevCommand } from "./dev";
export type { CommandRunner, DevConfig, DevRuntime } from "./dev";

/** Absolute path to the templates bundled in this installed package. */
export function builtinTemplatesDir(): string {
  return join(__dirname, "templates");
}

/** Absolute path to the modules bundled in this installed package. */
export function builtinModulesDir(): string {
  return join(__dirname, "templates", "modules");
}
