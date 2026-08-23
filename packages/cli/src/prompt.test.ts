import { describe, it, expect } from "vitest";
import { resolveCreateOptions, type Ask } from "./prompt";

const never: Ask = async () => {
  throw new Error("ask should not be called");
};

describe("resolveCreateOptions", () => {
  it("uses defaults without prompting when not interactive", async () => {
    const result = await resolveCreateOptions({}, never, false);
    expect(result).toEqual({
      template: "fullstack-nest-svelte",
      toolchain: { runtime: "node", runtimeVersion: "22.22.1", packageManager: "npm" },
    });
  });

  it("prefers explicit flags over prompts", async () => {
    const result = await resolveCreateOptions(
      { template: "base", runtime: "node", pm: "pnpm" },
      never,
      true,
    );
    expect(result.toolchain.packageManager).toBe("pnpm");
  });

  it("prompts for missing values when interactive", async () => {
    const answers = [" base ", "node", "yarn"];
    let i = 0;
    const ask: Ask = async () => (answers[i++] ?? "").trim();
    const result = await resolveCreateOptions({}, ask, true);
    expect(result.toolchain).toEqual({
      runtime: "node",
      runtimeVersion: "22.22.1",
      packageManager: "yarn",
    });
  });

  it("treats a blank answer as the default", async () => {
    const ask: Ask = async () => "";
    const result = await resolveCreateOptions({}, ask, true);
    expect(result.toolchain).toEqual({
      runtime: "node",
      runtimeVersion: "22.22.1",
      packageManager: "npm",
    });
  });

  it("rejects an unknown template", async () => {
    await expect(resolveCreateOptions({ template: "nope" }, never, false)).rejects.toThrow(/Unknown template/);
  });

  it("rejects an invalid package manager", async () => {
    await expect(resolveCreateOptions({ pm: "bun" as never }, never, false)).rejects.toThrow(
      /Invalid package manager/,
    );
  });

  it("selects Bun 1.4.0 without a separate package-manager prompt", async () => {
    const result = await resolveCreateOptions(
      { template: "base", runtime: "bun" },
      never,
      true,
    );
    expect(result.toolchain).toEqual({
      runtime: "bun",
      runtimeVersion: "1.4.0",
      packageManager: "bun",
    });
  });

  it("rejects Node package-manager flags in Bun mode", async () => {
    await expect(
      resolveCreateOptions({ runtime: "bun", pm: "npm" }, never, false),
    ).rejects.toThrow(/Remove --pm/);
  });
});
