import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { create, assertValidName } from "./create";

const REPO_TEMPLATES = resolve(process.cwd(), "..", "..", "templates");

const created: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "podokit-cli-"));
  created.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("assertValidName", () => {
  it("accepts sensible names", () => {
    expect(() => assertValidName("my-app")).not.toThrow();
    expect(() => assertValidName("app_1.2")).not.toThrow();
  });
  it("rejects empty and path-like names", () => {
    expect(() => assertValidName("")).toThrow();
    expect(() => assertValidName("../evil")).toThrow();
    expect(() => assertValidName("a/b")).toThrow();
  });
});

describe("create (integration against the base template)", () => {
  it("scaffolds a project with rendered project name", () => {
    const target = join(tmp(), "my-app");
    const result = create({ name: "my-app", templatesDir: REPO_TEMPLATES, targetDir: target });

    expect(result.projectDir).toBe(target);
    expect(result.packageManager).toBe("npm");

    const pkg = JSON.parse(readFileSync(join(target, "package.json"), "utf8")) as { name: string };
    expect(pkg.name).toBe("my-app");
    expect(existsSync(join(target, ".gitignore"))).toBe(true);
    expect(existsSync(join(target, ".env.example"))).toBe(true);
    expect(readFileSync(join(target, "README.md"), "utf8")).toContain("my-app");
  });

  it("refuses a non-empty target directory", () => {
    const target = tmp();
    mkdirSync(join(target, "sub"), { recursive: true });
    writeFileSync(join(target, "sub", "f.txt"), "x");
    expect(() => create({ name: "app", templatesDir: REPO_TEMPLATES, targetDir: join(target, "sub") })).toThrow(
      /not empty/,
    );
  });

  it("throws when the base template is missing", () => {
    expect(() => create({ name: "app", templatesDir: tmp(), targetDir: join(tmp(), "x") })).toThrow(
      /Base template not found/,
    );
  });
});
