import { describe, expect, it } from "vitest";
import { resolveToolchain, toolchainTemplateVars } from "./toolchain";

describe("toolchain", () => {
  it("pins the supported Bun profile and emits Bun-first command tokens", () => {
    const toolchain = resolveToolchain("bun");
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
  });

  it("keeps Node/npm as the default and rejects mixed profiles", () => {
    expect(resolveToolchain()).toEqual({
      runtime: "node",
      runtimeVersion: "22.22.1",
      packageManager: "npm",
    });
    expect(() => resolveToolchain("bun", "npm")).toThrow(/Remove --pm/);
    expect(() => resolveToolchain("node", "bun")).toThrow(/requires --runtime bun/);
    expect(toolchainTemplateVars(resolveToolchain())).toMatchObject({
      runtimeBinPrefix: "",
      apiRun: "npm --prefix apps/api run",
      webRun: "npm --prefix apps/web run",
    });
  });
});
