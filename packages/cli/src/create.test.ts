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

    // generation lockfile is written for future `podo update`
    const manifest = JSON.parse(readFileSync(join(target, ".podokit", "manifest.json"), "utf8")) as {
      template: string;
      answers: Record<string, string>;
      modules: unknown[];
    };
    expect(manifest.template).toBe("base");
    expect(manifest.answers.projectName).toBe("my-app");
    expect(manifest.modules).toEqual([]);
    expect(existsSync(join(target, ".podokit", "files.lock"))).toBe(true);
  });

  it("ships AI agent guidance by default and omits it with ai:false", () => {
    const withAi = join(tmp(), "with-ai");
    create({ name: "with-ai", templatesDir: REPO_TEMPLATES, targetDir: withAi });
    expect(existsSync(join(withAi, "AGENTS.md"))).toBe(true);
    expect(readFileSync(join(withAi, "CLAUDE.md"), "utf8")).toContain("@AGENTS.md");
    expect(existsSync(join(withAi, ".cursor/rules/podokit.mdc"))).toBe(true);
    expect(existsSync(join(withAi, ".github/copilot-instructions.md"))).toBe(true);
    expect(existsSync(join(withAi, ".claude/skills/podokit-nest-endpoint/SKILL.md"))).toBe(true);
    // AI files are user-owned so `podo update` never touches them
    const lock = JSON.parse(readFileSync(join(withAi, ".podokit/files.lock"), "utf8")) as {
      files: Record<string, { tier: string }>;
    };
    expect(lock.files["AGENTS.md"].tier).toBe("owned");

    const noAi = join(tmp(), "no-ai");
    create({ name: "no-ai", templatesDir: REPO_TEMPLATES, targetDir: noAi, ai: false });
    expect(existsSync(join(noAi, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(noAi, "CLAUDE.md"))).toBe(false);
    expect(existsSync(join(noAi, ".claude"))).toBe(false);
    expect(existsSync(join(noAi, ".cursor"))).toBe(false);
    // the app itself is still generated
    expect(existsSync(join(noAi, "apps/api/src/main.ts"))).toBe(true);
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

  it("ships the containerized dev environment (Traefik + internal services + devcontainer)", () => {
    const target = join(tmp(), "app");
    create({ name: "app", templatesDir: REPO_TEMPLATES, targetDir: target });

    // scaffolding files are generated (dot- prefixes resolved)
    expect(existsSync(join(target, "compose.dev.yaml"))).toBe(true);
    expect(existsSync(join(target, "Dockerfile.dev"))).toBe(true);
    expect(existsSync(join(target, ".dockerignore"))).toBe(true);
    expect(existsSync(join(target, ".env.docker"))).toBe(true);
    expect(existsSync(join(target, ".devcontainer", "devcontainer.json"))).toBe(true);
    expect(existsSync(join(target, "infra", "traefik", "dynamic.yml"))).toBe(true);

    const compose = readFileSync(join(target, "compose.dev.yaml"), "utf8");
    // project name is rendered into the workspace commands / stack name
    expect(compose).toContain("name: app-dev");
    expect(compose).toContain("npm run dev -w app-web");
    expect(compose).toContain("npm run dev -w app-api");
    // only Traefik binds a host port; the published port is a single env
    // (default 80) so several stacks can coexist, and the web container gets the
    // same value so Vite HMR targets the right port (no full-reload fallback).
    expect(compose).toContain('"${TRAEFIK_PORT:-80}:80"');
    expect(compose).toContain("VITE_HMR_CLIENT_PORT=${TRAEFIK_PORT:-80}");
    expect(compose).not.toMatch(/\n\s+-\s+"5432:5432"/);
    expect(compose).not.toMatch(/\n\s+-\s+"5001:5001"/);

    // HMR client port is derived from the injected env, never hardcoded to :80
    // (a hardcoded :80 breaks HMR on any non-80 Traefik stack — full reload that
    // wipes in-progress form input; misdiagnosed as a signup/login form bug).
    const viteConfig = readFileSync(join(target, "apps", "web", "vite.config.ts"), "utf8");
    expect(viteConfig).not.toContain("clientPort: 80");
    expect(viteConfig).toContain("Number(process.env.VITE_HMR_CLIENT_PORT)");
    // module-specific services are profile-gated so a minimal app never breaks
    expect(compose).toMatch(/profiles: \[queue\]/);
    expect(compose).toMatch(/profiles: \[cache\]/);
    expect(compose).toMatch(/profiles: \[storage\]/);

    // web proxies /api to the api container by service name (Traefik only routes web)
    expect(readFileSync(join(target, ".env.docker"), "utf8")).toContain("BACKEND_INTERNAL_URL=http://api:5002");
    expect(readFileSync(join(target, "infra", "traefik", "dynamic.yml"), "utf8")).toContain("http://web:5001");

    // AI-free of tiers: the dev scaffolding is owned so updates never clobber it
    const lock = readFileSync(join(target, ".podokit", "files.lock"), "utf8");
    expect(lock).toContain("compose.dev.yaml");
    for (const path of ["compose.dev.yaml", "Dockerfile.dev", ".devcontainer/devcontainer.json"]) {
      const entry = new RegExp(`"${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^}]*"tier"\\s*:\\s*"owned"`);
      expect(lock).toMatch(entry);
    }
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
    // e2e tests workspace ships with the app
    expect(existsSync(join(target, "tests", "playwright.config.ts"))).toBe(true);
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
