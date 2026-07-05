import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { copyTemplate, type TemplateVars } from "@podosoft/podokit-template-engine";

export type PackageManager = "npm" | "pnpm" | "yarn";

export interface CreateOptions {
  /** Project name; also the default directory name. */
  name: string;
  /** Directory that holds the template set (contains a `base/` folder). */
  templatesDir: string;
  /** Where to create the project. Defaults to `<cwd>/<name>`. */
  targetDir?: string;
  /** Package manager recorded in the generated project. Defaults to `npm`. */
  packageManager?: PackageManager;
}

export interface CreateResult {
  projectDir: string;
  packageManager: PackageManager;
}

const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-._]*[a-z0-9])?$/i;

/** Validate a project name: no path separators, npm-friendly characters. */
export function assertValidName(name: string): void {
  if (!name || !NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid project name "${name}". Use letters, digits, "-", "_", "." and no path separators.`,
    );
  }
}

function isEmptyDir(dir: string): boolean {
  return !existsSync(dir) || readdirSync(dir).length === 0;
}

/**
 * Scaffold a new project from the `base` template. Pure enough to test:
 * given a name and a templates directory, it writes files and returns where.
 */
export function create(options: CreateOptions): CreateResult {
  const { name, templatesDir } = options;
  assertValidName(name);

  const packageManager = options.packageManager ?? "npm";
  const projectDir = options.targetDir
    ? isAbsolute(options.targetDir)
      ? options.targetDir
      : resolve(process.cwd(), options.targetDir)
    : resolve(process.cwd(), name);

  if (!isEmptyDir(projectDir)) {
    throw new Error(`Target directory is not empty: ${projectDir}`);
  }

  const baseTemplate = join(templatesDir, "base");
  if (!existsSync(baseTemplate)) {
    throw new Error(`Base template not found at ${baseTemplate}`);
  }

  const vars: TemplateVars = { projectName: name, packageManager };
  copyTemplate(baseTemplate, projectDir, vars);

  return { projectDir, packageManager };
}
