import { describe, expect, it } from "vitest";
import { resolveCreateOptions, type Ask } from "./prompt";

const never: Ask = async () => {
  throw new Error("ask should not be called");
};

describe("resolveCreateOptions", () => {
  it("uses the Bun fullstack defaults without prompting", async () => {
    await expect(resolveCreateOptions({}, never, false)).resolves.toEqual({
      template: "fullstack",
      toolchain: { runtime: "bun", runtimeVersion: "1.4.0", packageManager: "bun" },
    });
  });

  it("prompts only for a missing template", async () => {
    const questions: string[] = [];
    const ask: Ask = async (question) => {
      questions.push(question);
      return "base";
    };
    const result = await resolveCreateOptions({}, ask, true);
    expect(result.template).toBe("base");
    expect(questions).toHaveLength(1);
  });

  it("rejects unknown templates, Node, and package-manager flags", async () => {
    await expect(resolveCreateOptions({ template: "nope" }, never, false)).rejects.toThrow("Unknown template");
    await expect(resolveCreateOptions({ runtime: "node" }, never, false)).rejects.toThrow("Bun-only");
    await expect(resolveCreateOptions({ pm: "npm" }, never, false)).rejects.toThrow("remove --pm");
  });
});
