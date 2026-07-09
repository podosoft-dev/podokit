import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { copyTemplate, type TemplateVars } from "@podosoft/podokit-template-engine";
import { DEFAULT_TEMPLATE } from "./templates";
import { initLockfile } from "./lockfile";

export type PackageManager = "npm" | "pnpm" | "yarn";

export { DEFAULT_TEMPLATE };

export interface CreateOptions {
  /** Project name; also the default directory name. */
  name: string;
  /** Directory that holds the template sets (each in its own subfolder). */
  templatesDir: string;
  /** Template subfolder to use. Defaults to `fullstack-nest-svelte`. */
  template?: string;
  /** Where to create the project. Defaults to `<cwd>/<name>`. */
  targetDir?: string;
  /** Package manager recorded in the generated project. Defaults to `npm`. */
  packageManager?: PackageManager;
  /** PodoKit version stamped into the lockfile. Defaults to the CLI version. */
  podokitVersion?: string;
}

export interface CreateResult {
  projectDir: string;
  packageManager: PackageManager;
  template: string;
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

  const template = options.template ?? DEFAULT_TEMPLATE;
  const packageManager = options.packageManager ?? "npm";
  const projectDir = options.targetDir
    ? isAbsolute(options.targetDir)
      ? options.targetDir
      : resolve(process.cwd(), options.targetDir)
    : resolve(process.cwd(), name);

  if (!isEmptyDir(projectDir)) {
    throw new Error(`Target directory is not empty: ${projectDir}`);
  }

  const templateDir = join(templatesDir, template);
  if (!existsSync(templateDir)) {
    throw new Error(`Template "${template}" not found at ${templateDir}`);
  }

  const vars: TemplateVars = { projectName: name, packageManager };
  copyTemplate(templateDir, projectDir, vars);

  initLockfile(projectDir, {
    template,
    packageManager,
    answers: { projectName: name, packageManager },
    version: options.podokitVersion,
  });

  return { projectDir, packageManager, template };
}
