import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { create } from "./create";
import { addModule, listModules } from "./add";
import {
  computeFilesLock,
  computeDrift,
  readFilesLock,
  readManifest,
  writeFilesLock,
  writeManifest,
} from "./lockfile";

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
  it("includes auth", () => {
    expect(listModules(MODULES).map((m) => m.name)).toContain("auth");
  });
});

describe("module-declared ownedGlobs", () => {
  it("merges into the manifest so the module's public path stays owned", () => {
    const project = generate("fullstack-nest-svelte");
    // a throwaway fixture module that ships a $lib file and declares it owned
    const modulesDir = join(tmp(), "modules");
    const fileRel = "apps/web/src/lib/widget/Widget.svelte";
    writeFile(join(modulesDir, "widget", "files", fileRel), "<p>widget</p>");
    writeFile(
      join(modulesDir, "widget", "module.manifest.json"),
      JSON.stringify({
        name: "widget",
        description: "test",
        targetApp: "web",
        ownedGlobs: ["apps/web/src/lib/widget/**"],
      }),
    );

    const result = addModule({ projectRoot: project, module: "widget", modulesDir });
    expect(result.ownedGlobs).toContain("apps/web/src/lib/widget/**");

    const manifest = JSON.parse(readFileSync(join(project, ".podokit/manifest.json"), "utf8")) as {
      ownedGlobs: string[];
    };
    expect(manifest.ownedGlobs).toContain("apps/web/src/lib/widget/**");
    const lock = JSON.parse(readFileSync(join(project, ".podokit/files.lock"), "utf8")) as {
      files: Record<string, { tier: string }>;
    };
    expect(lock.files[fileRel].tier).toBe("owned");
  });
});

describe("adopting an existing owned feature", () => {
  it("preserves owned files by default and adopts only declared managed paths", () => {
    const project = generate("fullstack-nest-svelte");
    const modulesDir = join(tmp(), "modules");
    const fileRel = "apps/api/src/blog/legacy.ts";
    writeFile(join(project, fileRel), "legacy\n");
    const projectManifest = readManifest(project)!;
    projectManifest.ownedGlobs.push(fileRel);
    writeManifest(project, projectManifest);
    writeFilesLock(project, computeFilesLock(project, projectManifest.ownedGlobs));

    writeFile(join(modulesDir, "blog", "files", fileRel), "managed\n");
    writeFile(
      join(modulesDir, "blog", "module.manifest.json"),
      JSON.stringify({
        name: "blog",
        description: "test",
        targetApp: "api",
        managedGlobs: ["apps/api/src/blog/**"],
      }),
    );

    const preserved = addModule({ projectRoot: project, module: "blog", modulesDir });
    expect(preserved.preserved).toContain(fileRel);
    expect(readFileSync(join(project, fileRel), "utf8")).toBe("legacy\n");

    const adopted = addModule({ projectRoot: project, module: "blog", modulesDir, adopt: true });
    expect(adopted.adopted).toContain(fileRel);
    expect(readFileSync(join(project, fileRel), "utf8")).toBe("managed\n");
    expect(readManifest(project)?.ownedGlobs).not.toContain(fileRel);
    expect(readFilesLock(project)?.files[fileRel].tier).toBe("managed");
  });
});

describe("lock safety while adding modules", () => {
  it("keeps pre-existing drift and unrelated app files outside the generated baseline", () => {
    const project = generate("fullstack-nest-svelte");
    const appModule = "apps/api/src/app.module.ts";
    const previousEntry = readFilesLock(project)!.files[appModule];
    writeFileSync(join(project, appModule), `${readFileSync(join(project, appModule), "utf8")}\n// app edit\n`);
    const appFile = "apps/api/src/customer-domain.ts";
    writeFile(join(project, appFile), "export const customerDomain = true;\n");

    const modulesDir = join(tmp(), "modules");
    writeFile(
      join(modulesDir, "widget", "module.manifest.json"),
      JSON.stringify({
        name: "widget",
        description: "test",
        targetApp: "api",
        inject: [
          {
            file: appModule,
            marker: "// podokit:end:imports",
            text: 'import { WidgetModule } from "./widget/widget.module";',
          },
        ],
      }),
    );
    writeFile(
      join(modulesDir, "widget", "files/apps/api/src/widget/widget.module.ts"),
      "export class WidgetModule {}\n",
    );

    addModule({ projectRoot: project, module: "widget", modulesDir });

    const lock = readFilesLock(project)!;
    expect(lock.files[appModule].outHash).toBe(previousEntry.outHash);
    expect(lock.files[appFile]).toBeUndefined();
    expect(lock.files["apps/api/src/widget/widget.module.ts"]?.tier).toBe("managed");
    expect(computeDrift(project).drifted).toContain(appModule);
  });
});

describe("external-module resolution", () => {
  function installPackageModule(project: string, pkg: string, manifest: object, fileRel?: string): void {
    const pkgDir = join(project, "node_modules", pkg);
    writeFile(join(pkgDir, "package.json"), JSON.stringify({ name: pkg, version: "1.0.0" }));
    writeFile(join(pkgDir, "module.manifest.json"), JSON.stringify(manifest));
    if (fileRel) writeFile(join(pkgDir, "files", fileRel), "pkg");
  }

  it("resolves and applies a module from an installed @podosoft/podokit-module-* package", () => {
    const project = generate("fullstack-nest-svelte");
    const fileRel = "apps/api/src/hello/hello.txt";
    installPackageModule(
      project,
      "@podosoft/podokit-module-hello",
      { manifestVersion: 1, name: "hello", description: "pkg module", targetApp: "api" },
      fileRel,
    );
    // listed alongside the bundled modules
    expect(listModules(MODULES, project).map((m) => m.name)).toContain("hello");
    // applied exactly like a bundled module
    const result = addModule({ projectRoot: project, module: "hello", modulesDir: MODULES });
    expect(result.module).toBe("hello");
    expect(existsSync(join(project, fileRel))).toBe(true);
  });

  it("rejects a module manifest from a newer CLI", () => {
    const project = generate("fullstack-nest-svelte");
    installPackageModule(project, "@podosoft/podokit-module-future", {
      manifestVersion: 99,
      name: "future",
      description: "x",
      targetApp: "api",
    });
    expect(() => addModule({ projectRoot: project, module: "future", modulesDir: MODULES })).toThrow(
      /newer PodoKit/,
    );
  });
});

describe("mailer extraction", () => {
  it("auth pulls in the mailer module, which ships a decoupled mail library", () => {
    const project = generate("fullstack-nest-svelte");
    const result = addModule({ projectRoot: project, module: "auth", modulesDir: MODULES });
    // auth requires mailer -> auto-added
    expect(result.added).toContain("mailer");
    // mailer ships the mail library with its own pool (no dependency on auth)
    expect(existsSync(join(project, "apps/api/src/mail/mailer.ts"))).toBe(true);
    expect(existsSync(join(project, "apps/api/src/mail/db.ts"))).toBe(true);
    expect(readFileSync(join(project, "apps/api/src/mail/mailer.ts"), "utf8")).toContain('from "./db"');
    // auth's email flows go through the mailer module's file
    expect(readFileSync(join(project, "apps/api/src/auth/auth.ts"), "utf8")).toContain('from "../mail/mailer"');
    // nodemailer ships via the mailer module (merged into the api workspace)
    const apiPkg = JSON.parse(readFileSync(join(project, "apps/api/package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(apiPkg.dependencies.nodemailer).toBeDefined();
    const manifest = JSON.parse(readFileSync(join(project, ".podokit/manifest.json"), "utf8")) as {
      modules: { name: string }[];
    };
    expect(manifest.modules.map((m) => m.name)).toContain("mailer");
  });
});

describe("app.extensions DI slot", () => {
  it("ships an owned extensions file wired into app.module", () => {
    const project = generate("fullstack-nest-svelte");
    expect(existsSync(join(project, "apps/api/src/app.extensions.ts"))).toBe(true);
    const appModule = readFileSync(join(project, "apps/api/src/app.module.ts"), "utf8");
    expect(appModule).toContain("import { extensionImports, extensionProviders }");
    expect(appModule).toContain("...extensionImports");
    expect(appModule).toContain("...extensionProviders");
    const lock = JSON.parse(readFileSync(join(project, ".podokit/files.lock"), "utf8")) as {
      files: Record<string, { tier: string }>;
    };
    expect(lock.files["apps/api/src/app.extensions.ts"].tier).toBe("owned");
  });
});

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

describe("addModule (auth / better-auth)", () => {
  it("overlays files, merges deps, appends env, and wires a global guard", () => {
    const project = generate("fullstack-nest-svelte");
    const result = addModule({ projectRoot: project, module: "auth", modulesDir: MODULES });

    expect(result.module).toBe("auth");
    // files overlaid
    expect(existsSync(join(project, "apps/api/src/auth/auth.ts"))).toBe(true);
    expect(existsSync(join(project, "apps/api/src/account/account.controller.ts"))).toBe(true);
    // deps merged into the api workspace
    const apiPkg = JSON.parse(readFileSync(join(project, "apps/api/package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(apiPkg.dependencies["better-auth"]).toBeDefined();
    expect(apiPkg.dependencies["@thallesp/nestjs-better-auth"]).toBeDefined();
    expect(apiPkg.scripts["auth:configure"]).toBe("node scripts/configure-auth.mjs");
    expect(existsSync(join(project, "apps/api/scripts/configure-auth.mjs"))).toBe(true);
    // secure-by-default: global guard wired
    const appModule = readFileSync(join(project, "apps/api/src/app.module.ts"), "utf8");
    expect(appModule).toContain("AuthModule.forRoot(authRuntime),");
    expect(appModule).toContain("{ provide: APP_GUARD, useClass: AuthGuard },");
    // the demo /account controller is registered via its module
    expect(appModule).toContain("AccountModule,");
    // health stays public (overlaid controller marked @Public)
    expect(readFileSync(join(project, "apps/api/src/health/health.controller.ts"), "utf8")).toContain("@Public()");
    // env example appended
    expect(readFileSync(join(project, ".env.example"), "utf8")).toContain("BETTER_AUTH_SECRET");
    // the module is recorded in the manifest for future `podo update`
    const manifest = JSON.parse(readFileSync(join(project, ".podokit/manifest.json"), "utf8")) as {
      modules: { name: string }[];
    };
    expect(manifest.modules.map((m) => m.name)).toContain("auth");
  });

  it("injects module guidance into AGENTS.md, and tolerates its absence", () => {
    const project = generate("fullstack-nest-svelte");
    addModule({ projectRoot: project, module: "auth", modulesDir: MODULES });
    const agents = readFileSync(join(project, "AGENTS.md"), "utf8");
    expect(agents).toContain("### auth (better-auth)");
    expect(agents.match(/<!-- podokit:end:agents-modules -->/g)?.length).toBe(1);

    // an app generated with --no-ai has no AGENTS.md; the optional inject must not throw
    const noAi = join(tmp(), "no-ai");
    create({ name: "app", template: "fullstack-nest-svelte", templatesDir: REPO_TEMPLATES, targetDir: noAi, ai: false });
    expect(() => addModule({ projectRoot: noAi, module: "auth", modulesDir: MODULES })).not.toThrow();
  });

  it("is idempotent for wiring when applied twice", () => {
    const project = generate("fullstack-nest-svelte");
    addModule({ projectRoot: project, module: "auth", modulesDir: MODULES });
    addModule({ projectRoot: project, module: "auth", modulesDir: MODULES });
    const appModule = readFileSync(join(project, "apps/api/src/app.module.ts"), "utf8");
    // wiring stays singular
    expect(appModule.match(/AuthModule\.forRoot\(authRuntime\),/g)?.length).toBe(1);
    // fenced regions stay intact and singular (injection lands inside them)
    expect(appModule.match(/\/\/ podokit:begin:module-imports/g)?.length).toBe(1);
    expect(appModule.match(/\/\/ podokit:end:module-imports/g)?.length).toBe(1);
    const region = appModule.slice(
      appModule.indexOf("// podokit:begin:module-imports"),
      appModule.indexOf("// podokit:end:module-imports"),
    );
    expect(region).toContain("AuthModule.forRoot(authRuntime),");
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

  it("adds object-storage-s3 with provider config, env, and a MinIO compose overlay", () => {
    const project = generate("fullstack-nest-svelte");
    addModule({ projectRoot: project, module: "object-storage-s3", modulesDir: MODULES });

    expect(existsSync(join(project, "apps/api/src/storage/storage.service.ts"))).toBe(true);
    expect(existsSync(join(project, "apps/api/src/storage/storage.config.ts"))).toBe(true);
    expect(existsSync(join(project, "infra/docker/minio.compose.yml"))).toBe(true);
    const apiPkg = JSON.parse(readFileSync(join(project, "apps/api/package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(apiPkg.dependencies["@aws-sdk/client-s3"]).toBeDefined();
    const env = readFileSync(join(project, ".env.example"), "utf8");
    expect(env).toContain("STORAGE_PROVIDER=minio");
    expect(readFileSync(join(project, "apps/api/src/app.module.ts"), "utf8")).toContain("StorageModule,");
  });

  it("auto-adds a required module (file-upload pulls in object-storage-s3)", () => {
    const project = generate("fullstack-nest-svelte");
    const result = addModule({ projectRoot: project, module: "file-upload", modulesDir: MODULES });

    expect(result.added).toContain("object-storage-s3");
    // both modules' files are present
    expect(existsSync(join(project, "apps/api/src/files/files.controller.ts"))).toBe(true);
    expect(existsSync(join(project, "apps/api/src/storage/storage.service.ts"))).toBe(true);
    // the controller loads @types/multer's global augmentation explicitly, since the
    // api tsconfig's `types: ["node"]` allowlist would otherwise suppress it and break
    // the build on `Express.Multer.File`.
    const filesController = readFileSync(join(project, "apps/api/src/files/files.controller.ts"), "utf8");
    expect(filesController).toContain('/// <reference types="multer" />');
    // both are wired
    const appModule = readFileSync(join(project, "apps/api/src/app.module.ts"), "utf8");
    expect(appModule).toContain("FilesModule,");
    expect(appModule).toContain("StorageModule,");
  });

  it("does not re-add an already-present required module", () => {
    const project = generate("fullstack-nest-svelte");
    addModule({ projectRoot: project, module: "object-storage-s3", modulesDir: MODULES });
    const result = addModule({ projectRoot: project, module: "file-upload", modulesDir: MODULES });
    expect(result.added).not.toContain("object-storage-s3");
    // storage wiring still appears exactly once
    const appModule = readFileSync(join(project, "apps/api/src/app.module.ts"), "utf8");
    expect(appModule.match(/StorageModule,/g)?.length).toBe(1);
  });

  it("adds sse with an events stream and wires it", () => {
    const project = generate("fullstack-nest-svelte");
    addModule({ projectRoot: project, module: "sse", modulesDir: MODULES });
    expect(existsSync(join(project, "apps/api/src/events/events.controller.ts"))).toBe(true);
    expect(existsSync(join(project, "apps/api/src/events/events.service.ts"))).toBe(true);
    expect(readFileSync(join(project, "apps/api/src/app.module.ts"), "utf8")).toContain("EventsModule,");
  });

  it("adds redis with a client and cache endpoints", () => {
    const project = generate("fullstack-nest-svelte");
    addModule({ projectRoot: project, module: "redis", modulesDir: MODULES });
    expect(existsSync(join(project, "apps/api/src/redis/redis.service.ts"))).toBe(true);
    const apiPkg = JSON.parse(readFileSync(join(project, "apps/api/package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(apiPkg.dependencies["ioredis"]).toBeDefined();
    expect(readFileSync(join(project, "apps/api/src/app.module.ts"), "utf8")).toContain("RedisModule,");
  });

  it("job-progress composes bullmq + sse + redis and wires the worker", () => {
    const project = generate("fullstack-nest-svelte");
    const result = addModule({ projectRoot: project, module: "job-progress", modulesDir: MODULES });

    expect(result.added).toEqual(expect.arrayContaining(["bullmq", "sse", "redis"]));
    expect(existsSync(join(project, "apps/api/src/progress/progress.processor.ts"))).toBe(true);
    // API wiring
    expect(readFileSync(join(project, "apps/api/src/app.module.ts"), "utf8")).toContain("JobProgressModule,");
    // worker wiring (into bullmq's worker.module)
    const worker = readFileSync(join(project, "apps/api/src/jobs/worker.module.ts"), "utf8");
    expect(worker).toContain("ProgressProcessor,");
    expect(worker).toContain('BullModule.registerQueue({ name: "progress" }),');
    expect(worker).toContain("RedisModule,");
  });

  it("adds logging (nestjs-pino) with env and wiring", () => {
    const project = generate("fullstack-nest-svelte");
    addModule({ projectRoot: project, module: "logging", modulesDir: MODULES });
    expect(existsSync(join(project, "apps/api/src/logging/logging.module.ts"))).toBe(true);
    const apiPkg = JSON.parse(readFileSync(join(project, "apps/api/package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(apiPkg.dependencies["nestjs-pino"]).toBeDefined();
    expect(readFileSync(join(project, ".env.example"), "utf8")).toContain("LOG_LEVEL");
    expect(readFileSync(join(project, "apps/api/src/app.module.ts"), "utf8")).toContain("LoggingModule,");
  });

  it("audit-log composes auth and wires a global interceptor + migration", () => {
    const project = generate("fullstack-nest-svelte");
    const result = addModule({ projectRoot: project, module: "audit-log", modulesDir: MODULES });

    expect(result.added).toContain("auth");
    expect(existsSync(join(project, "apps/api/src/audit/audit.interceptor.ts"))).toBe(true);
    expect(existsSync(join(project, "apps/api/src/audit/audit-log.entity.ts"))).toBe(true);
    expect(existsSync(join(project, "apps/api/src/migrations/1720300000000-InitAuditLogs.ts"))).toBe(true);
    expect(readFileSync(join(project, "apps/api/src/app.module.ts"), "utf8")).toContain("AuditModule,");
  });

  it("rate-limit composes redis and wires a global throttler guard", () => {
    const project = generate("fullstack-nest-svelte");
    const result = addModule({ projectRoot: project, module: "rate-limit", modulesDir: MODULES });

    expect(result.added).toContain("redis");
    expect(existsSync(join(project, "apps/api/src/rate-limit/rate-limit.module.ts"))).toBe(true);
    const apiPkg = JSON.parse(readFileSync(join(project, "apps/api/package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(apiPkg.dependencies["@nestjs/throttler"]).toBeDefined();
    const envExample = readFileSync(join(project, ".env.example"), "utf8");
    expect(envExample).toContain("RATE_LIMIT_MAX");
    expect(envExample).toContain("RATE_LIMIT_RUNTIME_MAX");
    expect(readFileSync(join(project, "apps/api/src/app.module.ts"), "utf8")).toContain("RateLimitModule,");
    const rateLimitModule = readFileSync(join(project, "apps/api/src/rate-limit/rate-limit.module.ts"), "utf8");
    expect(rateLimitModule).toContain("ProxyAwareThrottlerGuard");
    expect(rateLimitModule).toContain('request.headers');
    expect(rateLimitModule).toContain('["/health", "/health/ready"]');
    expect(rateLimitModule).toContain("unthrottledHealthPaths.has(path)");
    expect(rateLimitModule).toContain('path === "/site/settings"');
  });

  it("api-key-auth composes auth and wires a machine controller", () => {
    const project = generate("fullstack-nest-svelte");
    const result = addModule({ projectRoot: project, module: "api-key-auth", modulesDir: MODULES });

    expect(result.added).toContain("auth");
    expect(existsSync(join(project, "apps/api/src/api-key/api-key.guard.ts"))).toBe(true);
    expect(readFileSync(join(project, ".env.example"), "utf8")).toContain("API_KEYS");
    expect(readFileSync(join(project, "apps/api/src/app.module.ts"), "utf8")).toContain("ApiKeyModule,");
  });

  it("admin-dashboard composes auth and overlays the dashboard UI + admin plugin", () => {
    const project = generate("fullstack-nest-svelte");
    const result = addModule({ projectRoot: project, module: "admin-dashboard", modulesDir: MODULES });

    expect(result.added).toContain("auth");
    // web overlay
    expect(existsSync(join(project, "apps/web/src/hooks.server.ts"))).toBe(true);
    expect(existsSync(join(project, "apps/web/src/routes/(auth)/login/+page.svelte"))).toBe(true);
    expect(existsSync(join(project, "apps/web/src/routes/(app)/+layout.svelte"))).toBe(true);
    expect(existsSync(join(project, "apps/web/src/lib/components/app-sidebar.svelte"))).toBe(true);
    expect(existsSync(join(project, "apps/web/src/lib/components/ui/sidebar/index.ts"))).toBe(true);
    // Public routes remain app-owned, while the managed runtime applies global
    // branding and theme settings through the starter layout's stable slot.
    expect(result.preserved).toEqual(expect.arrayContaining(["apps/web/src/routes/+page.svelte"]));
    expect(readFileSync(join(project, "apps/web/src/routes/+page.svelte"), "utf8")).toContain("API health");
    expect(readFileSync(join(project, "apps/web/src/lib/components/site-runtime.svelte"), "utf8")).toContain("applyTheme");
    expect(readFileSync(join(project, "apps/web/src/hooks.server.ts"), "utf8")).toContain("event.route.id === null");
    // i18n: message catalog + language switch
    expect(existsSync(join(project, "apps/web/src/lib/i18n/messages.ts"))).toBe(true);
    expect(existsSync(join(project, "apps/web/src/lib/components/language-switch.svelte"))).toBe(true);
    // admin plugin + bootstrap injected into auth.ts
    const authTs = readFileSync(join(project, "apps/api/src/auth/auth.ts"), "utf8");
    expect(authTs).toContain("plugins.push(admin(");
    expect(authTs).toContain("sendResetPassword");
    expect(authTs).toContain("databaseHooks");
    expect(authTs).toContain("trustedOrigins");
    // env
    expect(readFileSync(join(project, ".env.example"), "utf8")).toContain("ADMIN_EMAILS");
  });

  it("rejects a project without the target app", () => {
    const empty = tmp(); // no apps/api/package.json
    expect(() => addModule({ projectRoot: empty, module: "auth", modulesDir: MODULES })).toThrow(
      /does not look like a PodoKit project/,
    );
  });
});
