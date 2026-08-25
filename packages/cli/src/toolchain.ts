import type { TemplateVars } from "@podosoft/podokit-template-engine";

export const BUN_VERSION = "1.4.0";

export type Runtime = "bun";
export type PackageManager = "bun";

export interface Toolchain {
  runtime: Runtime;
  runtimeVersion: string;
  packageManager: PackageManager;
}

export function resolveToolchain(
  runtime: string = "bun",
  packageManager?: string,
): Toolchain {
  if (runtime !== "bun") {
    throw new Error(
      "PodoKit v1 generates Bun-only applications. Existing Node projects must remain on @podosoft/podokit@0.17.4.",
    );
  }
  if (packageManager && packageManager !== "bun") {
    throw new Error("PodoKit v1 uses Bun as its package manager; remove --pm.");
  }
  return { runtime: "bun", runtimeVersion: BUN_VERSION, packageManager: "bun" };
}

export function toolchainTemplateVars(toolchain: Toolchain): TemplateVars {
  return {
    runtime: toolchain.runtime,
    runtimeVersion: toolchain.runtimeVersion,
    runtimeCommand: "bun",
    runtimeBinPrefix: "bunx --bun ",
    packageManager: "bun",
    packageExecutor: "bunx --bun",
    packageExecutorCommand: "bunx",
    packageExecutorArgs: '"--bun", ',
    ciSetup: "- uses: oven-sh/setup-bun@v2\n        with:\n          bun-version: 1.4.0",
    ciInstallCommand: "bun ci",
    ciLintCommand: "bun run lint",
    ciTestCommand: "bun run test",
    profileRuntime: "bun",
    rootRun: "bun run",
    apiRun: "bun run --cwd apps/api",
    apiWorkspaceArg: "",
    webRun: "bun run --cwd apps/web",
  };
}

export function isRuntime(value: string): value is Runtime {
  return value === "bun";
}

export function toolchainMigrationCommand(_toolchain: Toolchain): string[] {
  return ["bun", "run", "migrate:all"];
}

export function toolchainWorkerCommand(_toolchain: Toolchain): string[] {
  return ["bun", "dist/main-worker.js"];
}
