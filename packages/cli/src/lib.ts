// Library entry point: the reusable functions behind the `podo` CLI, for other
// packages (e.g. @podosoft/podokit-mcp) to call without spawning the binary.
import { join } from "node:path";

export { listModules, addModule } from "./add";
export type { ModuleManifest, AddOptions, AddResult } from "./add";
export { status, diff, doctor, SUPPORTED_FRAMEWORKS } from "./inspect";
export type { StatusReport, DoctorFinding } from "./inspect";
export { planUpdate, summarize } from "./update";
export type { UpdatePlan, FileChange } from "./update";

/** Absolute path to the templates bundled in this installed package. */
export function builtinTemplatesDir(): string {
  return join(__dirname, "templates");
}

/** Absolute path to the modules bundled in this installed package. */
export function builtinModulesDir(): string {
  return join(__dirname, "templates", "modules");
}
