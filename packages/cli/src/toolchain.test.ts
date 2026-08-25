import { describe, expect, it } from "vitest";
import {
  resolveToolchain,
  toolchainMigrationCommand,
  toolchainTemplateVars,
  toolchainWorkerCommand,
} from "./toolchain";

describe("toolchain", () => {
  it("pins Bun 1.4.0 and emits Bun-only commands", () => {
    const toolchain = resolveToolchain();
    expect(toolchain).toEqual({
      runtime: "bun",
      runtimeVersion: "1.4.0",
      packageManager: "bun",
    });
    expect(toolchainTemplateVars(toolchain)).toMatchObject({
      runtimeCommand: "bun",
      runtimeBinPrefix: "bunx --bun ",
      packageExecutor: "bunx --bun",
      apiRun: "bun run --cwd apps/api",
      webRun: "bun run --cwd apps/web",
      ciInstallCommand: "bun ci",
    });
    expect(toolchainMigrationCommand(toolchain)).toEqual(["bun", "run", "migrate:all"]);
    expect(toolchainWorkerCommand(toolchain)).toEqual(["bun", "dist/main-worker.js"]);
  });

  it("rejects Node and non-Bun package managers", () => {
    expect(() => resolveToolchain("node")).toThrow("0.17.4");
    expect(() => resolveToolchain("bun", "npm")).toThrow("remove --pm");
  });
});
