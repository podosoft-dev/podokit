import { execFileSync } from "node:child_process";
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { create, assertValidName } from "./create";
import { readFilesLock } from "./lockfile";

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

function composeServiceBlocks(compose: string): Map<string, string[]> {
  const services = new Map<string, string[]>();
  let inServices = false;
  let current: string[] | undefined;
  for (const line of compose.split("\n")) {
    if (/^\S/.test(line)) {
      inServices = line === "services:";
      current = undefined;
      continue;
    }
    if (!inServices) continue;
    const service = /^ {2}([a-z0-9-]+):$/.exec(line);
    if (service?.[1]) {
      current = [];
      services.set(service[1], current);
    } else {
      current?.push(line);
    }
  }
  return services;
}

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
      template: "fullstack",
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
    expect(readme).toContain("bun install");
    expect(readme).not.toContain("{{packageManager}}");
    expect(readFileSync(join(target, ".podokit", "dev.json"), "utf8")).toContain("custom.localhost");
  });

  it("scaffolds the base template with a rendered project name", () => {
    const target = join(tmp(), "my-app");
    const result = create({ name: "my-app", template: "base", templatesDir: REPO_TEMPLATES, targetDir: target });

    expect(result.projectDir).toBe(target);
    expect(result.packageManager).toBe("bun");
    expect(result.template).toBe("base");

    const pkg = JSON.parse(readFileSync(join(target, "package.json"), "utf8")) as {
      name: string;
      engines: { bun: string };
    };
    expect(pkg.name).toBe("my-app");
    expect(pkg.engines.bun).toBe("1.4.0");
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

  it("scaffolds a Bun 1.4.0 project without Node command fallbacks", () => {
    const target = join(tmp(), "bun-app");
    const result = create({
      name: "bun-app",
      runtime: "bun",
      templatesDir: REPO_TEMPLATES,
      targetDir: target,
    });

    expect(result.toolchain).toEqual({
      runtime: "bun",
      runtimeVersion: "1.4.0",
      packageManager: "bun",
    });
    const rootPackage = JSON.parse(readFileSync(join(target, "package.json"), "utf8")) as {
      packageManager: string;
      engines: Record<string, string>;
      trustedDependencies: string[];
    };
    expect(rootPackage.packageManager).toBe("bun@1.4.0");
    expect(rootPackage.engines).toEqual({ bun: "1.4.0" });
    expect(rootPackage.trustedDependencies).toBeUndefined();
    expect(readFileSync(join(target, "bunfig.toml"), "utf8")).toContain('auto = "disable"');
    expect(readFileSync(join(target, "apps/api/package.json"), "utf8")).toContain(
      '"test": "bun test src"',
    );
    // One setup command for every app: from source in development and from the
    // compiled output in a production image.
    expect(readFileSync(join(target, "apps/api/package.json"), "utf8")).toContain(
      '"migrate:all": "bun scripts/run-migrations.mjs"',
    );
    expect(existsSync(join(target, "apps/api/scripts/run-migrations.mjs"))).toBe(true);
    for (const workspace of ["api", "web"]) {
      const { scripts } = JSON.parse(
        readFileSync(join(target, `apps/${workspace}/package.json`), "utf8"),
      ) as { scripts: Record<string, string> };
      // A bare bunx honors a tool's Node shebang and runs it on whatever Node is on PATH.
      for (const name of ["build", "lint", "test"]) {
        for (const invocation of scripts[name]?.match(/bunx(?: --bun)?/g) ?? []) {
          expect(invocation, `${workspace} ${name}`).toBe("bunx --bun");
        }
      }
    }
    const apiMain = readFileSync(join(target, "apps/api/src/main.ts"), "utf8");
    expect(apiMain).toContain("async function bootstrap(): Promise<void>");
    expect(apiMain).toContain("await services.start()");
    expect(apiMain).toContain("...apiServerOptions(env)");
    expect(readFileSync(join(target, "apps/api/src/app.extensions.ts"), "utf8"))
      .toContain("export const apiServerOptions: ApiServerOptionsSource = {};");
    // Application-owned API seams that managed files import, seeded empty.
    const apiSeams: ReadonlyArray<readonly [string, string]> = [
      ["apps/api/src/config/env.extensions.ts", "export const appEnvShape = {} satisfies z.ZodRawShape;"],
      ["apps/api/src/database/entities.ts", "export const APP_ENTITIES: AppEntities = [];"],
      ["apps/api/src/core/api-contract.extensions.ts", "export const APP_DOCUMENTED_ROUTES: readonly string[] = [];"],
      ["apps/api/scripts/build.extensions.mjs", "export const appBuildTargets = [];"],
    ];
    for (const [path, seed] of apiSeams) {
      expect(readFileSync(join(target, path), "utf8")).toContain(seed);
      expect(readFilesLock(target)?.files[path]?.tier).toBe("owned");
    }
    const landingPage = readFileSync(join(target, "apps/web/src/routes/+page.svelte"), "utf8");
    expect(landingPage).toContain("Your PodoKit application is ready.");
    expect(landingPage).not.toMatch(/\b(?:Bun|Elysia|SvelteKit)\b/);
    for (const workspace of ["api", "web"]) {
      const dockerfile = readFileSync(join(target, `apps/${workspace}/Dockerfile`), "utf8");
      expect(dockerfile).toContain("FROM oven/bun:1.4.0-alpine");
      expect(dockerfile).toContain("RUN bun ci");
      if (workspace === "api") {
        expect(dockerfile).toContain(
          "RUN bun install --production --frozen-lockfile --filter './apps/api'",
        );
      } else {
        expect(dockerfile).not.toContain("bun install --production");
      }
      expect(dockerfile).toContain(`RUN bun run --cwd apps/${workspace} build`);
      expect(dockerfile).not.toContain("bun --cwd");
      expect(dockerfile).not.toContain("FROM node:");
      expect(dockerfile).not.toContain("npm ");
    }
    const workflow = readFileSync(join(target, ".github/workflows/release.yml"), "utf8");
    expect(workflow).toContain("oven-sh/setup-bun@v2");
    expect(workflow).toContain("bun-version: 1.4.0");
    expect(workflow).not.toContain("actions/setup-node");
    const developmentCompose = readFileSync(join(target, "compose.dev.yaml"), "utf8");
    expect(developmentCompose).toContain(
      "bun run --cwd apps/api dev",
    );
    expect(developmentCompose).toContain("pgsty/silo:RELEASE.2026-09-16T00-00-00Z");
    expect(developmentCompose).toContain("pgsty/mc:RELEASE.2026-09-16T00-00-00Z");
    const devDockerfile = readFileSync(join(target, "Dockerfile.dev"), "utf8");
    expect(devDockerfile).toContain("FROM oven/bun:1.4.0-alpine");
    expect(devDockerfile).toContain(
      "RUN apk add --no-cache git python3 make g++ ca-certificates",
    );
    expect(devDockerfile).not.toContain("apt-get");
    const infrastructure = readFileSync(
      join(target, "infra/docker/docker-compose.yml"),
      "utf8",
    );
    expect(infrastructure).toContain("image: oven/bun:1.4.0-alpine");
    expect(infrastructure).toContain('command: ["bun", "/app/sms-sink.mjs"]');
    expect(infrastructure).not.toContain("image: node:");
    const devcontainer = JSON.parse(
      readFileSync(join(target, ".devcontainer/devcontainer.json"), "utf8"),
    ) as { remoteUser: string };
    expect(devcontainer.remoteUser).toBe("bun");
    const manifest = JSON.parse(
      readFileSync(join(target, ".podokit/manifest.json"), "utf8"),
    ) as { schemaVersion: number; toolchain: Record<string, string>; packageManager?: string };
    expect(manifest.schemaVersion).toBe(4);
    expect(manifest.toolchain).toEqual(result.toolchain);
    expect(manifest.packageManager).toBeUndefined();
  });

  it("records and renders the selected database provider", () => {
    const target = join(tmp(), "sqlite-app");
    const result = create({
      name: "sqlite-app",
      templatesDir: REPO_TEMPLATES,
      targetDir: target,
      database: "sqlite",
    });
    expect(result.providers.database).toBe("sqlite");
    const manifest = JSON.parse(
      readFileSync(join(target, ".podokit/manifest.json"), "utf8"),
    ) as { providers: Record<string, string> };
    expect(manifest.providers).toMatchObject({
      database: "sqlite",
      cache: "redis",
      "object-storage": "s3",
    });
    expect(readFileSync(join(target, "apps/api/src/config/providers.ts"), "utf8"))
      .toContain('database: "sqlite"');
  });

  it.each(["base", "todo"])("applies the Bun profile to the %s template", (template) => {
    const target = join(tmp(), `bun-${template}`);
    create({
      name: `bun-${template}`,
      template,
      runtime: "bun",
      templatesDir: REPO_TEMPLATES,
      targetDir: target,
    });

    expect(readFileSync(join(target, "package.json"), "utf8")).toContain('"bun@1.4.0"');
    expect(readFileSync(join(target, "bunfig.toml"), "utf8")).toContain('linker = "hoisted"');
    const guidance = readFileSync(join(target, "AGENTS.md"), "utf8");
    expect(guidance).toContain("bun install");
    expect(guidance).toContain("bun run build");
    expect(guidance).not.toContain("npm install");
    if (template === "todo") {
      expect(readFileSync(join(target, "apps/web/Dockerfile"), "utf8")).toContain(
        "oven/bun:1.4.0-alpine",
      );
      const landingPage = readFileSync(join(target, "apps/web/src/routes/+page.svelte"), "utf8");
      expect(landingPage).toContain("Create, complete, and remove items.");
      expect(landingPage).not.toMatch(/\b(?:Bun|Elysia|SvelteKit)\b/);
    }
  });

  it("ships AI agent guidance by default and omits it with ai:false", () => {
    const withAi = join(tmp(), "with-ai");
    create({ name: "with-ai", templatesDir: REPO_TEMPLATES, targetDir: withAi });
    expect(existsSync(join(withAi, "AGENTS.md"))).toBe(true);
    expect(readFileSync(join(withAi, "CLAUDE.md"), "utf8")).toContain("@AGENTS.md");
    expect(existsSync(join(withAi, ".cursor/rules/podokit.mdc"))).toBe(true);
    expect(existsSync(join(withAi, ".github/copilot-instructions.md"))).toBe(true);
    expect(existsSync(join(withAi, ".claude/skills/podokit-elysia-endpoint/SKILL.md"))).toBe(true);
    const endpointGuidance = readFileSync(
      join(withAi, ".claude/skills/podokit-elysia-endpoint/SKILL.md"),
      "utf8",
    );
    expect(endpointGuidance).toContain("same parameter name at the same structural route position");
    expect(endpointGuidance).toContain("bun run --cwd apps/api contract");
    expect(existsSync(join(withAi, ".agents/skills/podokit-deploy/SKILL.md"))).toBe(true);
    expect(existsSync(join(withAi, ".claude/skills/podokit-deploy/SKILL.md"))).toBe(true);
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
    expect(existsSync(join(noAi, ".agents"))).toBe(false);
    expect(existsSync(join(noAi, ".cursor"))).toBe(false);
    // the app itself is still generated
    expect(existsSync(join(noAi, "apps/api/src/main.ts"))).toBe(true);
  });

  it("scaffolds the clean fullstack template by default (no domain code)", () => {
    const target = join(tmp(), "app");
    const result = create({ name: "app", templatesDir: REPO_TEMPLATES, targetDir: target });

    expect(result.template).toBe("fullstack");
    expect(existsSync(join(target, "apps", "api", "src", "main.ts"))).toBe(true);
    expect(existsSync(join(target, "apps", "api", "src", "database", "data-source.ts"))).toBe(true);
    expect(existsSync(join(target, "apps", "web", "svelte.config.js"))).toBe(false);
    const viteConfig = readFileSync(join(target, "apps", "web", "vite.config.ts"), "utf8");
    expect(viteConfig).toContain('import adapter from "@sveltejs/adapter-bun"');
    expect(viteConfig).toContain("sveltekit({");
    expect(viteConfig).toContain("preprocess: vitePreprocess()");
    expect(viteConfig).not.toContain("alias:");
    const webPkg = JSON.parse(
      readFileSync(join(target, "apps", "web", "package.json"), "utf8"),
    ) as { imports: Record<string, string> };
    expect(webPkg.imports).toEqual({ "#lib/*": "./src/lib/*" });
    const appHtml = readFileSync(join(target, "apps", "web", "src", "app.html"), "utf8");
    expect(appHtml).toContain("%sveltekit.head%");
    expect(appHtml).not.toContain("<title>");
    expect(readFileSync(join(target, "apps", "web", "src", "routes", "+page.svelte"), "utf8"))
      .toContain('from "#lib/api.js"');
    const webTsconfig = JSON.parse(
      readFileSync(join(target, "apps", "web", "tsconfig.json"), "utf8"),
    ) as { extends: string; include: string[] };
    expect(webTsconfig.extends).toBe("$app/tsconfig");
    expect(webTsconfig.include).toEqual(["src", "vite.config.ts", "vite.extensions.ts"]);
    // Application Vite and SvelteKit options live in an owned file next to the managed config.
    expect(viteConfig).toContain('from "./vite.extensions.ts"');
    expect(readFilesLock(target)?.files["apps/web/vite.extensions.ts"]?.tier).toBe("owned");
    // Application styles live in an owned file the managed app.css imports last.
    const appCss = readFileSync(join(target, "apps", "web", "src", "app.css"), "utf8");
    expect(appCss.trimEnd().endsWith('@import "./app.extensions.css";')).toBe(true);
    expect(readFilesLock(target)?.files["apps/web/src/app.extensions.css"]?.tier).toBe("owned");
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
    const input = readFileSync(
      join(target, "apps", "web", "src", "lib", "components", "ui", "input", "input.svelte"),
      "utf8",
    );
    expect(input).toContain("\t\tonchange,");
    expect(input.match(/\{onchange\}/g)).toHaveLength(2);
    expect(input).toContain("\t\tbind:files\n\t\t{onchange}");

    for (const workspace of ["api", "web"]) {
      const dockerfile = readFileSync(join(target, "apps", workspace, "Dockerfile"), "utf8");
      expect(dockerfile).toContain("FROM oven/bun:1.4.0-alpine AS deps");
      expect(dockerfile).toContain("RUN bun ci");
      expect(dockerfile).toContain(`RUN bun run --cwd apps/${workspace} build`);
      expect(dockerfile).not.toContain("FROM node:");

      // Every workspace manifest must reach `bun ci`. Listing them by hand silently
      // installs a different tree for a project that adds one.
      expect(dockerfile).toContain("FROM oven/bun:1.4.0-alpine AS manifests");
      expect(dockerfile).toContain('find . -name package.json -not -path "*/node_modules/*"');
      // The whole install output, not just the root node_modules, so nested
      // directories Bun creates for unhoistable versions survive into the build.
      expect(dockerfile).toContain("COPY --from=deps /app ./");
      expect(dockerfile).not.toContain("COPY --from=deps /app/node_modules");
      // Local workspace packages compile before the app that imports them.
      expect(dockerfile).toContain('bun run --cwd "$(dirname "$manifest")" --if-present build');
      expect(dockerfile).toContain("RUN mkdir -p /app/packages");
      expect(dockerfile).not.toContain("COPY --from=build /app/node_modules");
      expect(dockerfile).toContain("HEALTHCHECK");
      expect(dockerfile).toContain("process.env.PORT ?? '3000'");
      if (workspace === "api") {
        // Local workspace packages ship as real directories. node_modules only holds
        // symlinks to them, and a dangling link fails at boot rather than at build.
        expect(dockerfile).toContain("COPY --from=build /app/packages ./packages");
        // The API runtime tree comes from prod-deps, never from a stage holding dev deps.
        expect(dockerfile).toContain("FROM oven/bun:1.4.0-alpine AS prod-deps");
        expect(dockerfile).toContain("COPY --from=prod-deps /app/node_modules ./node_modules");
        expect(dockerfile).toContain("--frozen-lockfile");
        expect(dockerfile).toContain(
          "COPY --from=build /app/apps/api/scripts ./apps/api/scripts",
        );
        expect(existsSync(join(target, "apps/api/scripts/.keep"))).toBe(true);
      } else {
        // adapter-bun bundles the production server, so the web runtime needs
        // neither production node_modules nor workspace source packages.
        expect(dockerfile).not.toContain("AS prod-deps");
        expect(dockerfile).not.toContain("/app/node_modules");
        expect(dockerfile).not.toContain("COPY --from=build /app/packages ./packages");
        expect(dockerfile).toContain("ENV BODY_SIZE_LIMIT=3M");
        // Outlasts the /api proxy's 30-second deadline plus Bun's 4-second idle tick.
        expect(dockerfile).toContain("ENV CONNECTION_IDLE_TIMEOUT=35");
        expect(dockerfile).toContain('CMD ["bun", "./build"]');
        expect(dockerfile).not.toContain("server.js");
      }
    }
    const rootPkg = JSON.parse(readFileSync(join(target, "package.json"), "utf8")) as {
      engines: { bun: string };
    };
    expect(rootPkg.engines.bun).toBe("1.4.0");

    const healthPlugin = readFileSync(join(target, "apps", "api", "src", "health", "health.plugin.ts"), "utf8");
    expect(healthPlugin).toContain('"/health/ready"');
    expect(healthPlugin).toContain("readiness.run()");
    expect(existsSync(join(target, "apps", "api", "src", "health", "readiness.service.ts"))).toBe(true);
    expect(existsSync(join(target, "apps", "api", "src", "config", "redis.connection.ts"))).toBe(true);
  });

  it("ships the shadcn-svelte textarea that the blog and analytics modules use", () => {
    const target = join(tmp(), "app");
    create({ name: "app", templatesDir: REPO_TEMPLATES, targetDir: target });
    const textareaDir = join(target, "apps", "web", "src", "lib", "components", "ui", "textarea");
    const component = readFileSync(join(textareaDir, "textarea.svelte"), "utf8");
    expect(component).toContain('from "#lib/utils.js"');
    expect(component).toContain('"data-slot": dataSlot = "textarea"');
    expect(component).toContain("field-sizing-content");
    expect(readFileSync(join(textareaDir, "index.ts"), "utf8")).toContain("Root as Textarea");

    // `shadcn-svelte add` needs every alias and appends the extension itself.
    const components = JSON.parse(readFileSync(join(target, "apps", "web", "components.json"), "utf8")) as {
      aliases: Record<string, string>;
    };
    expect(components.aliases).toMatchObject({ utils: "#lib/utils", hooks: "#lib/hooks", lib: "#lib", ui: "#lib/components/ui" });

    // The modules rely on the shared copy instead of shipping their own, so
    // removing one never deletes the component another page uses.
    for (const module of ["podokit-module-blog", "podokit-module-analytics"]) {
      const moduleDir = resolve(process.cwd(), "..", module);
      const manifest = JSON.parse(readFileSync(join(moduleDir, "module.manifest.json"), "utf8")) as {
        requiredProjectFiles?: string[];
      };
      expect(manifest.requiredProjectFiles).toEqual(
        expect.arrayContaining([
          "apps/web/src/lib/components/ui/textarea/index.ts",
          "apps/web/src/lib/components/ui/textarea/textarea.svelte",
        ]),
      );
      for (const required of manifest.requiredProjectFiles ?? []) {
        expect(existsSync(join(target, required))).toBe(true);
      }
      expect(existsSync(join(moduleDir, "files", "apps", "web", "src", "lib", "components", "ui", "textarea"))).toBe(false);
    }
  });

  it("ships the containerized dev environment (Traefik + internal services + devcontainer)", () => {
    const target = join(tmp(), "app");
    create({ name: "app", templatesDir: REPO_TEMPLATES, targetDir: target });

    // scaffolding files are generated (dot- prefixes resolved)
    expect(existsSync(join(target, "compose.dev.yaml"))).toBe(true);
    expect(existsSync(join(target, "Dockerfile.dev"))).toBe(true);
    expect(existsSync(join(target, ".dockerignore"))).toBe(true);
    // The committed example holds no secret; podo dev creates the ignored
    // .env.docker from it, so a fresh clone gets a container environment.
    expect(existsSync(join(target, ".env.docker.example"))).toBe(true);
    expect(existsSync(join(target, ".env.docker"))).toBe(false);
    expect(readFileSync(join(target, ".env.docker.example"), "utf8")).toMatch(/^BETTER_AUTH_SECRET=$/m);
    expect(existsSync(join(target, ".devcontainer", "devcontainer.json"))).toBe(true);
    expect(existsSync(join(target, "infra", "traefik", "dynamic.yml"))).toBe(true);

    const compose = readFileSync(join(target, "compose.dev.yaml"), "utf8");
    expect(
      compose.match(/path: \.\/apps\/api\/scripts, target: \/app\/apps\/api\/scripts/g),
    ).toHaveLength(2);
    // project name is rendered into the workspace commands / stack name
    expect(compose).toContain("name: app-dev");
    expect(compose).toContain("bun run --cwd apps/web dev");
    expect(compose).toContain("bun run --cwd apps/api dev");
    // The legacy per-project proxy remains available only as an explicit profile;
    // podo dev normally connects the web service to one shared loopback gateway.
    expect(compose).toContain("profiles: [podokit-legacy-proxy]");
    expect(compose).toContain('"${TRAEFIK_PORT:-80}:80"');
    expect(compose).not.toContain("VITE_HMR_CLIENT_PORT");
    expect(compose).toContain("ADDRESS_HEADER=x-forwarded-for");
    expect(compose).toContain("XFF_DEPTH=1");
    expect(compose.match(/PODOKIT_NPM_REGISTRY: \$\{PODOKIT_NPM_REGISTRY:-\}/g)).toHaveLength(3);
    // Storage images are pinned, and a bucket that cannot be created fails the
    // init service instead of being ignored.
    for (const image of compose.match(/image: pgsty\/\S+/g) ?? []) {
      expect(image).toMatch(/@sha256:[0-9a-f]{64}$/);
    }
    expect(compose.match(/image: pgsty\//g)).toHaveLength(2);
    expect(compose).toContain("      - -ec\n");
    expect(compose).toContain("mc mb --ignore-existing loc/podokit\n");
    expect(compose).not.toContain("|| true");
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
    expect(devDockerfile).toContain('bun install --frozen-lockfile --registry "$PODOKIT_NPM_REGISTRY"');

    // web proxies /api to the api container by service name (Traefik only routes web)
    expect(readFileSync(join(target, ".env.docker.example"), "utf8")).toContain("BACKEND_INTERNAL_URL=http://api:5002");
    expect(readFileSync(join(target, ".env.docker.example"), "utf8")).toContain("BETTER_AUTH_URL=http://app.localhost");
    expect(readFileSync(join(target, ".podokit", "dev.json"), "utf8")).toContain('"hostname": "app.localhost"');
    expect(readFileSync(join(target, ".podokit", "dev.json"), "utf8")).toContain(
      '"webSocketPaths": []',
    );
    expect(readFileSync(join(target, ".podokit", "dev.json"), "utf8")).toContain(
      '"apiPaths": []',
    );
    expect(readFileSync(join(target, ".gitignore"), "utf8")).toContain(".podokit/runtime/");
    expect(readFileSync(join(target, ".gitignore"), "utf8")).toContain("!.env.docker.example\n");
    const backendProxy = readFileSync(
      join(target, "apps", "web", "src", "lib", "server", "backend-proxy.ts"),
      "utf8",
    );
    expect(backendProxy).toContain("request.arrayBuffer()");
    expect(backendProxy).not.toContain("request.text()");
    expect(backendProxy).toContain("export function resolveClientIp");
    expect(backendProxy).toContain("return undefined");
    const backendProxyTest = join(
      target,
      "apps",
      "web",
      "src",
      "lib",
      "server",
      "backend-proxy.test.ts",
    );
    expect(existsSync(backendProxyTest)).toBe(true);
    expect(readFileSync(backendProxyTest, "utf8")).toContain(
      'from "./backend-proxy"',
    );
    // App-specific proxy headers live in an owned file the managed proxy imports.
    expect(backendProxy).toContain('from "./proxy-headers"');
    const proxyHeaders = "apps/web/src/lib/server/proxy-headers.ts";
    expect(readFileSync(join(target, proxyHeaders), "utf8")).toContain(
      "export const APP_FORWARDED_REQUEST_HEADERS: readonly string[] = [];",
    );
    expect(readFilesLock(target)?.files[proxyHeaders]?.tier).toBe("owned");
    expect(backendProxy).toContain('from "./body-limits"');
    const bodyLimits = "apps/web/src/lib/server/body-limits.ts";
    expect(readFileSync(join(target, bodyLimits), "utf8")).toContain(
      "export const APP_BODY_LIMITS: ReadonlyArray<{ pathPrefix: string; maxBytes: number }> = [];",
    );
    expect(readFilesLock(target)?.files[bodyLimits]?.tier).toBe("owned");
    expect(backendProxy).toContain('from "./proxy-timeouts"');
    const proxyTimeouts = "apps/web/src/lib/server/proxy-timeouts.ts";
    expect(readFileSync(join(target, proxyTimeouts), "utf8")).toContain(
      "export const APP_PROXY_TIMEOUTS: ReadonlyArray<{ pathPrefix: string; timeoutMs: number | null }> = [];",
    );
    expect(readFilesLock(target)?.files[proxyTimeouts]?.tier).toBe("owned");
    expect(readFilesLock(target)?.files["apps/web/src/lib/server/backend-proxy.ts"]?.tier).toBe("managed");
    // The web server's health route answers the probes without calling the API.
    const healthRoute = "apps/web/src/routes/healthz/+server.ts";
    const healthSource = readFileSync(join(target, healthRoute), "utf8");
    expect(healthSource).toContain('"cache-control": "no-store"');
    expect(healthSource).not.toMatch(/serverApiClient|backend-proxy|fetch\(/);
    expect(readFileSync(join(target, "apps/web/Dockerfile"), "utf8")).toContain("'/healthz'");
    // SvelteKit's fallback when the root layout or a hook fails: self-contained,
    // app-owned, and without text that would need translating.
    const errorPage = readFileSync(join(target, "apps/web/src/error.html"), "utf8");
    expect(errorPage).toContain("<h1>%sveltekit.error.message%</h1>");
    expect(errorPage).toContain('<p class="status">%sveltekit.status%</p>');
    expect(errorPage).toContain("@media (prefers-color-scheme: dark)");
    expect(errorPage).not.toMatch(/<(?:script|link|img)\b|\b(?:src|href)=|url\(/);
    expect(readFilesLock(target)?.files["apps/web/src/error.html"]?.tier).toBe("owned");
    const serverApi = readFileSync(join(target, "apps", "web", "src", "lib", "server", "api.ts"), "utf8");
    expect(serverApi).toContain('headers.set("x-forwarded-for", clientIp)');
    expect(serverApi).toContain("resolveClientIp(event.getClientAddress)");
    const apiProxyRoute = readFileSync(
      join(target, "apps", "web", "src", "routes", "api", "[...path]", "+server.ts"),
      "utf8",
    );
    expect(apiProxyRoute).toContain("resolveClientIp(getClientAddress)");
    const traefikConfig = readFileSync(join(target, "infra", "traefik", "dynamic.yml"), "utf8");
    expect(traefikConfig).toContain("http://web:5001");
    expect(traefikConfig).toContain("middlewares: [compression]");
    expect(traefikConfig).toContain("compress: {}");

    // compress dynamic HTML/JSON at the edge in both local Traefik and k3s.
    const ingress = readFileSync(join(target, "infra", "k3s", "ingress.yaml"), "utf8");
    expect(ingress).toContain("kind: Middleware");
    expect(ingress).toContain("name: compression");
    expect(ingress).toContain("podokit-compression@kubernetescrd");
    expect(ingress).not.toContain("name: api");
    expect(ingress).not.toContain("path: /api");
    expect(ingress).toContain("name: web");
    const apiDeployment = readFileSync(
      join(target, "infra", "k3s", "api-deployment.yaml"),
      "utf8",
    );
    expect(apiDeployment).toContain("path: /health/ready");
    const k3sConfig = readFileSync(join(target, "infra", "k3s", "configmap.yaml"), "utf8");
    expect(k3sConfig).toContain('ADDRESS_HEADER: "x-forwarded-for"');
    expect(k3sConfig).toContain('XFF_DEPTH: "1"');
    expect(k3sConfig).toContain('BODY_SIZE_LIMIT: "3M"');
    expect(k3sConfig).toContain('CONNECTION_IDLE_TIMEOUT: "35"');
    expect(k3sConfig).toContain('API_IDLE_TIMEOUT: "35"');

    // AI-free of tiers: the dev scaffolding is owned so updates never clobber it
    const lock = readFileSync(join(target, ".podokit", "files.lock"), "utf8");
    expect(lock).toContain("compose.dev.yaml");
    for (const path of ["compose.dev.yaml", "Dockerfile.dev", ".devcontainer/devcontainer.json"]) {
      const entry = new RegExp(`"${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^}]*"tier"\\s*:\\s*"owned"`);
      expect(lock).toMatch(entry);
    }
  });

  it("bounds memory and swap equally for every dev compose service", () => {
    const target = join(tmp(), "app");
    create({ name: "app", templatesDir: REPO_TEMPLATES, targetDir: target });

    const services = composeServiceBlocks(readFileSync(join(target, "compose.dev.yaml"), "utf8"));
    expect([...services.keys()]).toEqual(
      expect.arrayContaining(["traefik", "web", "api", "worker", "postgres", "redis", "minio", "minio-init"]),
    );
    for (const [service, lines] of services) {
      const memory = lines.find((line) => line.startsWith("    mem_limit: "));
      const swap = lines.find((line) => line.startsWith("    memswap_limit: "));
      expect(memory, service).toMatch(/^ {4}mem_limit: \$\{[A-Z_]+_MEM_LIMIT:-\d+[mg]\}$/);
      expect(swap?.replace("memswap_limit", "mem_limit"), service).toBe(memory);
    }
    // A full Playwright run kept the Vite dev server near 1.9 GiB; 2 GiB was OOM-killed.
    expect(services.get("web")).toContain("    mem_limit: ${WEB_MEM_LIMIT:-3g}");
  });

  it("scaffolds the todo template with the CRUD example", () => {
    const target = join(tmp(), "app");
    const result = create({ name: "app", template: "todo", templatesDir: REPO_TEMPLATES, targetDir: target });

    expect(result.template).toBe("todo");
    expect(existsSync(join(target, "apps", "api", "src", "todos", "todo.plugin.ts"))).toBe(true);
    expect(existsSync(join(target, "apps", "api", "src", "migrations"))).toBe(true);
    // API access goes through the generic proxy + ApiClient (no per-resource proxy route)
    expect(existsSync(join(target, "apps", "web", "src", "routes", "api", "[...path]", "+server.ts"))).toBe(true);
    expect(existsSync(join(target, "apps", "web", "src", "lib", "api.ts"))).toBe(true);
    // shadcn-svelte components ship preinstalled
    expect(existsSync(join(target, "apps", "web", "src", "lib", "components", "ui", "button", "button.svelte"))).toBe(true);
    expect(existsSync(join(target, "apps", "web", "src", "lib", "utils.ts"))).toBe(true);
    // e2e tests workspace ships with the app
    expect(existsSync(join(target, "tests", "playwright.config.ts"))).toBe(true);
    expect(existsSync(join(target, "tests", "playwright.extensions.ts"))).toBe(true);
    expect(readFileSync(join(target, "tests", "playwright.config.ts"), "utf8")).toContain(
      "loadPlaywrightProjects(coreProjects)",
    );
    const manifest = readFileSync(join(target, ".podokit", "manifest.json"), "utf8");
    expect(manifest).toContain("tests/playwright.projects.cjs");
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

  it.each(["fullstack", "todo"])(
    "scaffolds audited dependency floors in the %s template",
    (template) => {
      const target = join(tmp(), "secure-app");
      create({ name: "secure-app", template, templatesDir: REPO_TEMPLATES, targetDir: target });

      const rootPkg = JSON.parse(readFileSync(join(target, "package.json"), "utf8")) as {
        overrides: Record<string, Record<string, string>>;
      };
      const apiPkg = JSON.parse(
        readFileSync(join(target, "apps", "api", "package.json"), "utf8"),
      ) as { devDependencies: Record<string, string> };
      const webPkg = JSON.parse(
        readFileSync(join(target, "apps", "web", "package.json"), "utf8"),
      ) as { devDependencies: Record<string, string> };

      expect(rootPkg.overrides["@sveltejs/kit"]?.cookie).toBe("2.0.1");
      expect(apiPkg.devDependencies["@types/bun"]).toBe("^1.3.9");
      expect(webPkg.devDependencies["@sveltejs/vite-plugin-svelte"]).toBe("^7.3.0");
      expect(webPkg.devDependencies["@sveltejs/adapter-bun"]).toBe("1.0.0-next.1");
      expect(webPkg.devDependencies["@sveltejs/adapter-node"]).toBeUndefined();
      expect(webPkg.devDependencies["@sveltejs/kit"]).toBe("3.0.0-next.25");
      expect(webPkg.devDependencies.vite).toBe("^8.2.1");
    },
  );

  it.each(["fullstack", "todo"])(
    "documents the shared development gateway in the %s generated README",
    (template) => {
      const target = join(tmp(), "documented-app");
      create({ name: "documented-app", template, templatesDir: REPO_TEMPLATES, targetDir: target });

      const readme = readFileSync(join(target, "README.md"), "utf8");
      expect(readme).toContain("bunx --bun @podosoft/podokit dev watch");
      expect(readme).toContain("http://documented-app.localhost");
      expect(readme).toContain("Even a single app uses");
      expect(readme).toContain("bunx --bun @podosoft/podokit dev down");
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
