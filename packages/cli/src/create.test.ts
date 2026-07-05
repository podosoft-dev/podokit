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

describe("create (integration against templates)", () => {
  it("scaffolds the base template with a rendered project name", () => {
    const target = join(tmp(), "my-app");
    const result = create({ name: "my-app", template: "base", templatesDir: REPO_TEMPLATES, targetDir: target });

    expect(result.projectDir).toBe(target);
    expect(result.packageManager).toBe("npm");
    expect(result.template).toBe("base");

    const pkg = JSON.parse(readFileSync(join(target, "package.json"), "utf8")) as { name: string };
    expect(pkg.name).toBe("my-app");
    expect(existsSync(join(target, ".gitignore"))).toBe(true);
    expect(existsSync(join(target, ".env.example"))).toBe(true);
    expect(readFileSync(join(target, "README.md"), "utf8")).toContain("my-app");
  });

  it("scaffolds the clean fullstack template by default (no domain code)", () => {
    const target = join(tmp(), "app");
    const result = create({ name: "app", templatesDir: REPO_TEMPLATES, targetDir: target });

    expect(result.template).toBe("fullstack-nest-svelte");
    expect(existsSync(join(target, "apps", "api", "src", "main.ts"))).toBe(true);
    expect(existsSync(join(target, "apps", "api", "src", "database", "data-source.ts"))).toBe(true);
    expect(existsSync(join(target, "apps", "web", "svelte.config.js"))).toBe(true);
    expect(existsSync(join(target, "infra", "k3s", "ingress.yaml"))).toBe(true);
    // The clean starter ships no todo domain code.
    expect(existsSync(join(target, "apps", "api", "src", "todos"))).toBe(false);
    expect(existsSync(join(target, "apps", "web", "src", "routes", "api", "todos"))).toBe(false);
    const apiPkg = JSON.parse(readFileSync(join(target, "apps", "api", "package.json"), "utf8")) as { name: string };
    expect(apiPkg.name).toBe("app-api");
  });

  it("scaffolds the todo template with the CRUD example", () => {
    const target = join(tmp(), "app");
    const result = create({ name: "app", template: "todo", templatesDir: REPO_TEMPLATES, targetDir: target });

    expect(result.template).toBe("todo");
    expect(existsSync(join(target, "apps", "api", "src", "todos", "todos.controller.ts"))).toBe(true);
    expect(existsSync(join(target, "apps", "api", "src", "migrations"))).toBe(true);
    // API access goes through the generic proxy + ApiClient (no per-resource proxy route)
    expect(existsSync(join(target, "apps", "web", "src", "routes", "api", "[...path]", "+server.ts"))).toBe(true);
    expect(existsSync(join(target, "apps", "web", "src", "lib", "api.ts"))).toBe(true);
    // shadcn-svelte components ship preinstalled
    expect(existsSync(join(target, "apps", "web", "src", "lib", "components", "ui", "button", "button.svelte"))).toBe(true);
    expect(existsSync(join(target, "apps", "web", "src", "lib", "utils.ts"))).toBe(true);
  });

  it("refuses a non-empty target directory", () => {
    const target = tmp();
    mkdirSync(join(target, "sub"), { recursive: true });
    writeFileSync(join(target, "sub", "f.txt"), "x");
    expect(() =>
      create({ name: "app", template: "base", templatesDir: REPO_TEMPLATES, targetDir: join(target, "sub") }),
    ).toThrow(/not empty/);
  });

  it("throws when the template is missing", () => {
    expect(() =>
      create({ name: "app", template: "nope", templatesDir: REPO_TEMPLATES, targetDir: join(tmp(), "x") }),
    ).toThrow(/Template "nope" not found/);
  });
});
