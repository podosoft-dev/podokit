import type { TemplateVars } from "@podosoft/podokit-template-engine";

export const NODE_VERSION = "22.22.1";
export const BUN_VERSION = "1.4.0";

export type Runtime = "node" | "bun";
export type NodePackageManager = "npm" | "pnpm" | "yarn";
export type PackageManager = NodePackageManager | "bun";

export interface Toolchain {
  runtime: Runtime;
  runtimeVersion: string;
  packageManager: PackageManager;
}

export function resolveToolchain(
  runtime: Runtime = "node",
  packageManager?: PackageManager,
): Toolchain {
  if (runtime === "bun") {
    if (packageManager && packageManager !== "bun") {
      throw new Error('Bun runtime requires the "bun" package manager. Remove --pm.');
    }
    return { runtime, runtimeVersion: BUN_VERSION, packageManager: "bun" };
  }
  if (packageManager === "bun") {
    throw new Error('The "bun" package manager requires --runtime bun.');
  }
  return {
    runtime,
    runtimeVersion: NODE_VERSION,
    packageManager: packageManager ?? "npm",
  };
}

export function toolchainTemplateVars(toolchain: Toolchain): TemplateVars {
  const packageExecutor =
    toolchain.packageManager === "npm"
      ? "npx"
      : toolchain.packageManager === "pnpm"
        ? "pnpm dlx"
        : toolchain.packageManager === "yarn"
          ? "yarn dlx"
          : "bunx --bun";
  const packageExecutorCommand =
    toolchain.packageManager === "npm"
      ? "npx"
      : toolchain.packageManager === "pnpm"
        ? "pnpm"
        : toolchain.packageManager === "yarn"
          ? "yarn"
          : "bunx";
  const packageExecutorArgs =
    toolchain.packageManager === "npm"
      ? '"-y", '
      : toolchain.packageManager === "bun"
        ? '"--bun", '
        : '"dlx", ';
  return {
    runtime: toolchain.runtime,
    runtimeVersion: toolchain.runtimeVersion,
    runtimeCommand: toolchain.runtime === "bun" ? "bun" : "node",
    runtimeBinPrefix: toolchain.runtime === "bun" ? "bunx --bun " : "",
    packageManager: toolchain.packageManager,
    packageExecutor,
    packageExecutorCommand,
    packageExecutorArgs,
    ciSetup:
      toolchain.runtime === "bun"
        ? "- uses: oven-sh/setup-bun@v2\n        with:\n          bun-version: 1.4.0"
        : "- uses: actions/setup-node@v6\n        with:\n          node-version: 22\n          cache: npm",
    ciInstallCommand: toolchain.runtime === "bun" ? "bun ci" : "npm ci --no-audit --no-fund",
    ciLintCommand: toolchain.runtime === "bun" ? "bun run lint" : "npm run lint",
    ciTestCommand: toolchain.runtime === "bun" ? "bun run test" : "npm test",
    profileRuntime: toolchain.runtime === "bun" ? "bun" : "node --input-type=module",
    rootRun: `${toolchain.packageManager} run`,
    apiRun: workspaceRun(toolchain.packageManager, "apps/api"),
    apiWorkspaceArg: "",
    webRun: workspaceRun(toolchain.packageManager, "apps/web"),
  };
}

function workspaceRun(packageManager: PackageManager, path: string): string {
  if (packageManager === "bun") return `bun run --cwd ${path}`;
  if (packageManager === "npm") return `npm --prefix ${path} run`;
  if (packageManager === "pnpm") return `pnpm --dir ${path} run`;
  return `yarn --cwd ${path} run`;
}

export function isRuntime(value: string): value is Runtime {
  return value === "node" || value === "bun";
}

export function isNodePackageManager(value: string): value is NodePackageManager {
  return value === "npm" || value === "pnpm" || value === "yarn";
}

export function toolchainMigrationCommand(toolchain: Toolchain): string[] {
  return [toolchain.packageManager, "run", "migrate:all"];
}
