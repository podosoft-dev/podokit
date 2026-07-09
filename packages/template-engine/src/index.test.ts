import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  renderTokens,
  resolveOutputName,
  mergePackageJson,
  copyTemplate,
  insertAtMarker,
  renderTemplate,
  writeTree,
  hashContent,
} from "./index";

const created: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "podokit-te-"));
  created.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("renderTokens", () => {
  it("substitutes known tokens", () => {
    expect(renderTokens("# {{projectName}}", { projectName: "my-app" })).toBe("# my-app");
  });
  it("tolerates whitespace inside braces", () => {
    expect(renderTokens("{{ name }}", { name: "x" })).toBe("x");
  });
  it("leaves unknown tokens untouched", () => {
    expect(renderTokens("{{unknown}}", { name: "x" })).toBe("{{unknown}}");
  });
});

describe("resolveOutputName", () => {
  it("restores dot-prefixed files", () => {
    expect(resolveOutputName("dot-gitignore")).toBe(".gitignore");
    expect(resolveOutputName("dot-env.example")).toBe(".env.example");
  });
  it("leaves normal names unchanged", () => {
    expect(resolveOutputName("package.json")).toBe("package.json");
  });
});

describe("mergePackageJson", () => {
  it("deep-merges objects and overlay scalars win", () => {
    const merged = mergePackageJson(
      { name: "base", scripts: { dev: "a" }, dependencies: { x: "1" } },
      { name: "over", scripts: { test: "b" }, dependencies: { y: "2" } },
    );
    expect(merged).toEqual({
      name: "over",
      scripts: { dev: "a", test: "b" },
      dependencies: { x: "1", y: "2" },
    });
  });
  it("concatenates and de-duplicates arrays", () => {
    const merged = mergePackageJson({ workspaces: ["apps/*"] }, { workspaces: ["apps/*", "packages/*"] });
    expect(merged.workspaces).toEqual(["apps/*", "packages/*"]);
  });
  it("does not mutate inputs", () => {
    const base = { scripts: { dev: "a" } };
    mergePackageJson(base, { scripts: { test: "b" } });
    expect(base).toEqual({ scripts: { dev: "a" } });
  });
});

describe("insertAtMarker", () => {
  const src = ["imports: [", "    HealthModule,", "    // podokit:module-imports", "  ],"].join("\n");

  it("inserts text above the marker with matching indentation", () => {
    const out = insertAtMarker(src, "// podokit:module-imports", "AuthModule,");
    expect(out).toContain("    AuthModule,\n    // podokit:module-imports");
  });

  it("is idempotent when the text is already present", () => {
    const once = insertAtMarker(src, "// podokit:module-imports", "AuthModule,");
    const twice = insertAtMarker(once, "// podokit:module-imports", "AuthModule,");
    expect(twice).toBe(once);
  });

  it("throws when the marker is missing", () => {
    expect(() => insertAtMarker(src, "// nope", "X")).toThrow(/Marker not found/);
  });
});

describe("copyTemplate", () => {
  it("renders text files, applies dot- convention, and recurses", () => {
    const src = tmp();
    const dest = join(tmp(), "out");
    writeFileSync(join(src, "README.md"), "# {{projectName}}");
    writeFileSync(join(src, "dot-gitignore"), "node_modules");
    mkdirSync(join(src, "apps"));
    writeFileSync(join(src, "apps", "info.txt"), "app {{projectName}}");

    copyTemplate(src, dest, { projectName: "demo" });

    expect(readFileSync(join(dest, "README.md"), "utf8")).toBe("# demo");
    expect(existsSync(join(dest, ".gitignore"))).toBe(true);
    expect(readFileSync(join(dest, "apps", "info.txt"), "utf8")).toBe("app demo");
  });
});

describe("renderTemplate / writeTree", () => {
  it("renders to an in-memory tree with POSIX paths and dot- convention", () => {
    const src = tmp();
    writeFileSync(join(src, "README.md"), "# {{projectName}}");
    writeFileSync(join(src, "dot-gitignore"), "node_modules");
    mkdirSync(join(src, "apps"));
    writeFileSync(join(src, "apps", "info.txt"), "app {{projectName}}");

    const tree = renderTemplate(src, { projectName: "demo" });

    expect([...tree.keys()].sort()).toEqual([".gitignore", "README.md", "apps/info.txt"]);
    expect(tree.get("README.md")).toEqual({ content: "# demo", text: true });
    expect(tree.get("apps/info.txt")?.content).toBe("app demo");
  });

  it("writeTree(renderTemplate(...)) matches copyTemplate on disk", () => {
    const src = tmp();
    writeFileSync(join(src, "README.md"), "# {{projectName}}");
    mkdirSync(join(src, "apps"));
    writeFileSync(join(src, "apps", "info.txt"), "app {{projectName}}");
    const viaCopy = join(tmp(), "copy");
    const viaTree = join(tmp(), "tree");

    copyTemplate(src, viaCopy, { projectName: "x" });
    writeTree(renderTemplate(src, { projectName: "x" }), viaTree);

    expect(readFileSync(join(viaTree, "apps", "info.txt"), "utf8")).toBe(
      readFileSync(join(viaCopy, "apps", "info.txt"), "utf8"),
    );
  });
});

describe("hashContent", () => {
  it("is stable and prefixed", () => {
    expect(hashContent("hello")).toBe(hashContent("hello"));
    expect(hashContent("hello")).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
  it("differs for different content and matches string/Buffer", () => {
    expect(hashContent("a")).not.toBe(hashContent("b"));
    expect(hashContent("a")).toBe(hashContent(Buffer.from("a")));
  });
});
