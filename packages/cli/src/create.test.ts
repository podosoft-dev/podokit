import { execFileSync } from "node:child_process";
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { create, assertValidName } from "./create";

const REPO_TEMPLATES = resolve(process.cwd(), "..", "..", "templates");
const DEV_WATCH = resolve(process.cwd(), "..", "..", "scripts", "dev-watch.mjs");

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
  it("renders every template variable during a dev-watch sync", () => {
    const target = join(tmp(), "different-directory-name");
    create({
      name: "manifest-project-name",
      template: "fullstack-nest-svelte",
      packageManager: "pnpm",
      templatesDir: REPO_TEMPLATES,
      targetDir: target,
    });
    writeFileSync(join(target, "README.md"), "stale\n");
    writeFileSync(
      join(target, ".podokit", "dev.json"),
      '{"schemaVersion":1,"hostname":"custom.localhost"}\n',
    );

    execFileSync(process.execPath, [DEV_WATCH, target, "--once"], { stdio: "pipe" });

    const readme = readFileSync(join(target, "README.md"), "utf8");
    expect(readme).toContain("# manifest-project-name");
    expect(readme).toContain("pnpm install");
    expect(readme).not.toContain("{{packageManager}}");
    expect(readFileSync(join(target, ".podokit", "dev.json"), "utf8")).toContain("custom.localhost");
  });

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
    const gitignore = readFileSync(join(target, ".gitignore"), "utf8");
    expect(gitignore).toContain("playwright/.auth/");
    expect(gitignore).toContain("playwright-report/");
    expect(gitignore).toContain("test-results/");
    expect(gitignore).toContain("tests/playwright/");
    expect(gitignore).toContain("tests/playwright-report/");
    expect(gitignore).toContain("tests/test-results/");
    expect(gitignore).toContain("output/lighthouse/");
    // The clean starter ships no todo domain code.
    expect(existsSync(join(target, "apps", "api", "src", "todos"))).toBe(false);
    expect(existsSync(join(target, "apps", "web", "src", "routes", "api", "todos"))).toBe(false);
    const apiPkg = JSON.parse(readFileSync(join(target, "apps", "api", "package.json"), "utf8")) as { name: string };
    expect(apiPkg.name).toBe("app-api");

    for (const workspace of ["api", "web"]) {
      const dockerfile = readFileSync(join(target, "apps", workspace, "Dockerfile"), "utf8");
      expect(dockerfile).toContain("FROM node:22-alpine AS deps");
      expect(dockerfile).toContain("COPY package.json package-lock.json ./");
      expect(dockerfile).toContain("RUN npm ci --no-audit --no-fund");
      expect(dockerfile).toContain(`RUN npm run build --workspace=apps/${workspace}`);
      expect(dockerfile).not.toContain("npm install --omit=dev=false");
      if (workspace === "api") {
        expect(dockerfile).toContain(
          "COPY --from=build /app/apps/api/scripts ./apps/api/scripts",
        );
        expect(existsSync(join(target, "apps/api/scripts/.keep"))).toBe(true);
      } else {
        expect(dockerfile).toContain("ENV BODY_SIZE_LIMIT=3M");
      }
    }
    const rootPkg = JSON.parse(readFileSync(join(target, "package.json"), "utf8")) as {
      engines: { node: string };
    };
    expect(rootPkg.engines.node).toBe(">=22.22.1");

    const healthController = readFileSync(join(target, "apps", "api", "src", "health", "health.controller.ts"), "utf8");
    expect(healthController).toContain("ServiceUnavailableException");
    expect(healthController).toContain('throw new ServiceUnavailableException({ status: "degraded", db: "down" })');
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
    expect(
      compose.match(/path: \.\/apps\/api\/scripts, target: \/app\/apps\/api\/scripts/g),
    ).toHaveLength(2);
    // project name is rendered into the workspace commands / stack name
    expect(compose).toContain("name: app-dev");
    expect(compose).toContain("npm run dev -w app-web");
    expect(compose).toContain("npm run dev -w app-api");
    // The legacy per-project proxy remains available only as an explicit profile;
    // podo dev normally connects the web service to one shared loopback gateway.
    expect(compose).toContain("profiles: [podokit-legacy-proxy]");
    expect(compose).toContain('"${TRAEFIK_PORT:-80}:80"');
    expect(compose).not.toContain("VITE_HMR_CLIENT_PORT");
    expect(compose).toContain("ADDRESS_HEADER=x-forwarded-for");
    expect(compose).toContain("XFF_DEPTH=1");
    expect(compose.match(/PODOKIT_NPM_REGISTRY: \$\{PODOKIT_NPM_REGISTRY:-\}/g)).toHaveLength(3);
    expect(compose).not.toMatch(/\n\s+-\s+"5432:5432"/);
    expect(compose).not.toMatch(/\n\s+-\s+"5001:5001"/);

    // HMR derives the public endpoint from the browser origin so both the local
    // gateway and a provider-neutral HTTPS tunnel can proxy the WebSocket.
    const viteConfig = readFileSync(join(target, "apps", "web", "vite.config.ts"), "utf8");
    expect(viteConfig).not.toContain("clientPort: 80");
    expect(viteConfig).not.toContain("VITE_HMR_CLIENT_PORT");
    // module-specific services are profile-gated so a minimal app never breaks
    expect(compose).toMatch(/profiles: \[queue\]/);
    expect(compose).toMatch(/profiles: \[cache\]/);
    expect(compose).toMatch(/profiles: \[storage\]/);
    const devDockerfile = readFileSync(join(target, "Dockerfile.dev"), "utf8");
    expect(devDockerfile).toContain('ARG PODOKIT_NPM_REGISTRY=""');
    expect(devDockerfile).toContain('npm config set registry "$PODOKIT_NPM_REGISTRY"');

    // web proxies /api to the api container by service name (Traefik only routes web)
    expect(readFileSync(join(target, ".env.docker"), "utf8")).toContain("BACKEND_INTERNAL_URL=http://api:5002");
    expect(readFileSync(join(target, ".env.docker"), "utf8")).toContain("BETTER_AUTH_URL=http://app.localhost");
    expect(readFileSync(join(target, ".podokit", "dev.json"), "utf8")).toContain('"hostname": "app.localhost"');
    expect(readFileSync(join(target, ".gitignore"), "utf8")).toContain(".podokit/runtime/");
    const backendProxy = readFileSync(
      join(target, "apps", "web", "src", "lib", "server", "backend-proxy.ts"),
      "utf8",
    );
    expect(backendProxy).toContain("request.arrayBuffer()");
    expect(backendProxy).not.toContain("request.text()");
    const serverApi = readFileSync(join(target, "apps", "web", "src", "lib", "server", "api.ts"), "utf8");
    expect(serverApi).toContain('headers.set("x-forwarded-for", clientIp)');
    const traefikConfig = readFileSync(join(target, "infra", "traefik", "dynamic.yml"), "utf8");
    expect(traefikConfig).toContain("http://web:5001");
    expect(traefikConfig).toContain("middlewares: [compression]");
    expect(traefikConfig).toContain("compress: {}");

    // compress dynamic HTML/JSON at the edge in both local Traefik and k3s.
    const ingress = readFileSync(join(target, "infra", "k3s", "ingress.yaml"), "utf8");
    expect(ingress).toContain("kind: Middleware");
    expect(ingress).toContain("name: compression");
    expect(ingress).toContain("podokit-compression@kubernetescrd");
    const k3sConfig = readFileSync(join(target, "infra", "k3s", "configmap.yaml"), "utf8");
    expect(k3sConfig).toContain('ADDRESS_HEADER: "x-forwarded-for"');
    expect(k3sConfig).toContain('XFF_DEPTH: "1"');
    expect(k3sConfig).toContain('BODY_SIZE_LIMIT: "3M"');

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
    const gitignore = readFileSync(join(target, ".gitignore"), "utf8");
    expect(gitignore).toContain("playwright/.auth/");
    expect(gitignore).toContain("test-results/");
    expect(gitignore).toContain("tests/playwright/");
    expect(gitignore).toContain("tests/test-results/");
    expect(readFileSync(join(target, "infra", "traefik", "dynamic.yml"), "utf8")).toContain(
      "middlewares: [compression]",
    );
    expect(readFileSync(join(target, "infra", "k3s", "ingress.yaml"), "utf8")).toContain(
      "podokit-compression@kubernetescrd",
    );
  });

  it.each(["fullstack-nest-svelte", "todo"])(
    "documents the shared development gateway in the %s generated README",
    (template) => {
      const target = join(tmp(), "documented-app");
      create({ name: "documented-app", template, templatesDir: REPO_TEMPLATES, targetDir: target });

      const readme = readFileSync(join(target, "README.md"), "utf8");
      expect(readme).toContain("npx @podosoft/podokit dev watch");
      expect(readme).toContain("http://documented-app.localhost");
      expect(readme).toContain("Even a single app uses");
      expect(readme).toContain("npx @podosoft/podokit dev down");
      expect(readme).toContain("final registered");
      expect(readme).toContain("Alternative: host processes");

      const testingReadme = readFileSync(join(target, "tests", "README.md"), "utf8");
      expect(testingReadme).toContain("E2E_BASE_URL=http://documented-app.localhost");
      expect(testingReadme).toContain("default `http://localhost:5001`");
    },
  );

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
