import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { create } from "./create";
import { addModule, listModules } from "./add";

const REPO_TEMPLATES = resolve(process.cwd(), "..", "..", "templates");
const MODULES = join(REPO_TEMPLATES, "modules");

const created: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "podokit-add-"));
  created.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function generate(template: string): string {
  const target = join(tmp(), "app");
  create({ name: "app", template, templatesDir: REPO_TEMPLATES, targetDir: target });
  return target;
}

describe("listModules", () => {
  it("includes auth-jwt", () => {
    expect(listModules(MODULES).map((m) => m.name)).toContain("auth-jwt");
  });
});

describe("addModule (auth-jwt)", () => {
  it("overlays files, merges deps, appends env, and wires app.module", () => {
    const project = generate("fullstack-nest-svelte");
    const result = addModule({ projectRoot: project, module: "auth-jwt", modulesDir: MODULES });

    expect(result.module).toBe("auth-jwt");
    // files overlaid
    expect(existsSync(join(project, "apps/api/src/auth/auth.module.ts"))).toBe(true);
    expect(existsSync(join(project, "apps/api/src/auth/user.entity.ts"))).toBe(true);
    expect(existsSync(join(project, "apps/api/src/migrations/1720200000000-InitUsers.ts"))).toBe(true);
    // deps merged into the api workspace
    const apiPkg = JSON.parse(readFileSync(join(project, "apps/api/package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(apiPkg.dependencies["@nestjs/jwt"]).toBeDefined();
    expect(apiPkg.dependencies["passport-jwt"]).toBeDefined();
    // wiring injected at markers
    const appModule = readFileSync(join(project, "apps/api/src/app.module.ts"), "utf8");
    expect(appModule).toContain('import { AuthModule } from "./auth/auth.module";');
    expect(appModule).toContain("AuthModule,");
    // env example appended
    expect(readFileSync(join(project, ".env.example"), "utf8")).toContain("JWT_SECRET");
  });

  it("is idempotent for wiring when applied twice", () => {
    const project = generate("fullstack-nest-svelte");
    addModule({ projectRoot: project, module: "auth-jwt", modulesDir: MODULES });
    addModule({ projectRoot: project, module: "auth-jwt", modulesDir: MODULES });
    const appModule = readFileSync(join(project, "apps/api/src/app.module.ts"), "utf8");
    expect(appModule.match(/AuthModule,/g)?.length).toBe(1);
  });

  it("rejects an unknown module", () => {
    const project = generate("base");
    expect(() => addModule({ projectRoot: project, module: "nope", modulesDir: MODULES })).toThrow(
      /Unknown module/,
    );
  });

  it("adds bullmq with a separate worker entrypoint and scripts", () => {
    const project = generate("fullstack-nest-svelte");
    addModule({ projectRoot: project, module: "bullmq", modulesDir: MODULES });

    expect(existsSync(join(project, "apps/api/src/jobs/jobs.module.ts"))).toBe(true);
    expect(existsSync(join(project, "apps/api/src/jobs/worker.module.ts"))).toBe(true);
    expect(existsSync(join(project, "apps/api/src/main-worker.ts"))).toBe(true);
    // deployment reflects the worker
    expect(existsSync(join(project, "infra/k3s/worker-deployment.yaml"))).toBe(true);
    expect(existsSync(join(project, "infra/docker/worker.compose.example.yml"))).toBe(true);
    const apiPkg = JSON.parse(readFileSync(join(project, "apps/api/package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(apiPkg.dependencies["@nestjs/bullmq"]).toBeDefined();
    expect(apiPkg.scripts["dev:worker"]).toContain("main-worker");
    expect(readFileSync(join(project, "apps/api/src/app.module.ts"), "utf8")).toContain("JobsModule,");
  });

  it("rejects a project without the target app", () => {
    const empty = tmp(); // no apps/api/package.json
    expect(() => addModule({ projectRoot: empty, module: "auth-jwt", modulesDir: MODULES })).toThrow(
      /does not look like a PodoKit project/,
    );
  });
});
