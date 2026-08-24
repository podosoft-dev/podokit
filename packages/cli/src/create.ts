import { existsSync, readdirSync, rmSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { writeTree, type TemplateVars } from "@podosoft/podokit-template-engine";
import { DEFAULT_TEMPLATE } from "./templates";
import { initLockfile } from "./lockfile";
import { renderProjectTemplate } from "./assemble";
import {
  resolveToolchain,
  toolchainTemplateVars,
  type Runtime,
  type Toolchain,
} from "./toolchain";

/** AI agent guidance files, removed when scaffolding with `--no-ai`. */
const AI_ARTIFACTS = [
  "AGENTS.md",
  "CLAUDE.md",
  ".agents",
  ".claude",
  ".cursor",
  ".github/copilot-instructions.md",
];

export type PackageManager = "bun";

export { DEFAULT_TEMPLATE };

export interface CreateOptions {
  /** Project name; also the default directory name. */
  name: string;
  /** Directory that holds the template sets (each in its own subfolder). */
  templatesDir: string;
  /** Public template name. Defaults to `fullstack`. */
  template?: string;
  /** Where to create the project. Defaults to `<cwd>/<name>`. */
  targetDir?: string;
  /** Deprecated compatibility input. PodoKit v1 accepts only Bun. */
  packageManager?: PackageManager;
  /** Application runtime. PodoKit v1 accepts only Bun. */
  runtime?: Runtime;
  /** PodoKit version stamped into the lockfile. Defaults to the CLI version. */
  podokitVersion?: string;
  /** Include AI agent guidance (AGENTS.md, CLAUDE.md, editor rules). Defaults to true. */
  ai?: boolean;
}

export interface CreateResult {
  projectDir: string;
  packageManager: Toolchain["packageManager"];
  toolchain: Toolchain;
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
  const toolchain = resolveToolchain(options.runtime, options.packageManager);
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

  const vars: TemplateVars = {
    projectName: name,
    ...toolchainTemplateVars(toolchain),
  };
  writeTree(renderProjectTemplate(templatesDir, template, vars), projectDir);

  if (options.ai === false) {
    for (const artifact of AI_ARTIFACTS) rmSync(join(projectDir, artifact), { recursive: true, force: true });
  }

  initLockfile(projectDir, {
    template,
    toolchain,
    answers: vars,
    version: options.podokitVersion,
  });

  return {
    projectDir,
    packageManager: toolchain.packageManager,
    toolchain,
    template,
  };
}
