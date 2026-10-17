import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MODULE_PROVIDERS } from "../../../templates/fullstack/apps/api/src/core/api-contract";

const REPO_ROOT = resolve(process.cwd(), "..", "..");

function manifestProviders(dir: string): Array<[string, [string, string]]> {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return [];
    let manifest: { name: string; provides?: Record<string, string> };
    try {
      manifest = JSON.parse(readFileSync(join(dir, entry.name, "module.manifest.json"), "utf8"));
    } catch {
      return [];
    }
    return Object.entries(manifest.provides ?? {}).map(
      ([capability, provider]): [string, [string, string]] => [manifest.name, [capability, provider]],
    );
  });
}

describe("generated API contract check", () => {
  it("knows the provider of every provider module", () => {
    const provided = [
      ...manifestProviders(join(REPO_ROOT, "templates/modules")),
      ...manifestProviders(join(REPO_ROOT, "packages")),
    ].sort(([left], [right]) => left.localeCompare(right));

    expect(provided.length).toBeGreaterThan(0);
    expect(Object.entries(MODULE_PROVIDERS).sort(([left], [right]) => left.localeCompare(right))).toEqual(
      provided,
    );
  });
});
