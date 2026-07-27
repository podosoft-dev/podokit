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

describe("module project baseline requirements", () => {
  it("stops before mutation when a required baseline file is missing", () => {
    const project = generate("fullstack-nest-svelte");
    const readiness = join(
      project,
      "apps/api/src/health/readiness.service.ts",
    );
    rmSync(readiness);

    expect(() =>
      addModule({
        projectRoot: project,
        module: "object-storage-s3",
        modulesDir: MODULES,
      }),
    ).toThrow("Run podo update --apply");
    expect(existsSync(join(project, "apps/api/src/storage"))).toBe(false);
  });

  it("rejects required file paths that escape the project", () => {
    const project = generate("fullstack-nest-svelte");
    const modulesDir = join(tmp(), "modules");
    writeFile(
      join(modulesDir, "unsafe", "module.manifest.json"),
      JSON.stringify({
        name: "unsafe",
        description: "test",
        targetApp: "api",
        requiredProjectFiles: ["../outside"],
      }),
    );

    expect(() =>
      addModule({ projectRoot: project, module: "unsafe", modulesDir }),
    ).toThrow("invalid required project file");
  });

  it("stops before mutation when a required baseline contract is stale", () => {
    const project = generate("fullstack-nest-svelte");
    const modulesDir = join(tmp(), "modules");
    const baseline = "apps/api/src/config/runtime.ts";
    writeFile(join(project, baseline), "export const runtime = true;\n");
    writeFile(
      join(modulesDir, "contractual", "module.manifest.json"),
      JSON.stringify({
        name: "contractual",
        description: "test",
        targetApp: "api",
        requiredProjectContents: {
          [baseline]: ["export const requiredRuntime = true;"],
        },
      }),
    );
    writeFile(
      join(
        modulesDir,
        "contractual",
        "files/apps/api/src/contractual/contractual.module.ts",
      ),
      "export class ContractualModule {}\n",
    );

    expect(() =>
      addModule({ projectRoot: project, module: "contractual", modulesDir }),
    ).toThrow("Incompatible");
    expect(
      existsSync(
        join(
          project,
          "apps/api/src/contractual/contractual.module.ts",
        ),
      ),
    ).toBe(false);
  });

  it("preflights every required module before applying any overlay", () => {
    const project = generate("fullstack-nest-svelte");
    const modulesDir = join(tmp(), "modules");
    writeFile(
      join(modulesDir, "first", "module.manifest.json"),
      JSON.stringify({
        name: "first",
        description: "test",
        targetApp: "api",
      }),
    );
    writeFile(
      join(
        modulesDir,
        "first",
        "files/apps/api/src/first/first.module.ts",
      ),
      "export class FirstModule {}\n",
    );
    writeFile(
      join(modulesDir, "second", "module.manifest.json"),
      JSON.stringify({
        name: "second",
        description: "test",
        targetApp: "api",
        requiredProjectFiles: ["apps/api/src/missing-baseline.ts"],
      }),
    );
    writeFile(
      join(modulesDir, "parent", "module.manifest.json"),
      JSON.stringify({
        name: "parent",
        description: "test",
        targetApp: "api",
        requires: ["first", "second"],
      }),
    );

    expect(() =>
      addModule({ projectRoot: project, module: "parent", modulesDir }),
    ).toThrow("requires a newer PodoKit project baseline");
    expect(
      existsSync(join(project, "apps/api/src/first/first.module.ts")),
    ).toBe(false);
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

describe("module-declared package overlays", () => {
  it("merges scripts into an app other than targetApp", () => {
    const project = generate("fullstack-nest-svelte");
    const modulesDir = join(tmp(), "modules");
    writeFile(
      join(modulesDir, "multi-app", "module.manifest.json"),
      JSON.stringify({
        name: "multi-app",
        description: "test",
        targetApp: "web",
        packageOverlays: { api: { scripts: { "multi:check": "node scripts/check.mjs" } } },
      }),
    );

    const result = addModule({ projectRoot: project, module: "multi-app", modulesDir });
    const apiPkg = JSON.parse(readFileSync(join(project, "apps/api/package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(apiPkg.scripts["multi:check"]).toBe("node scripts/check.mjs");
    expect(result.touched).toContain("apps/api/package.json");
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
    const appModulePath = join(project, "apps/api/src/app.module.ts");
    const storageImport = 'import { StorageModule } from "./storage/storage.module";';
    writeFileSync(
      appModulePath,
      readFileSync(appModulePath, "utf8").replace(storageImport, "// intentionally customized"),
    );
    const result = addModule({ projectRoot: project, module: "file-upload", modulesDir: MODULES });
    expect(result.added).not.toContain("object-storage-s3");
    // The manifest is authoritative: a missing or customized first injection
    // must not cause a dependency add to re-overlay the installed module.
    const appModule = readFileSync(appModulePath, "utf8");
    expect(appModule).not.toContain(storageImport);
    expect(appModule.match(/StorageModule,/g)?.length).toBe(1);
  });

  it("adds sse with an events stream and wires it", () => {
    const project = generate("fullstack-nest-svelte");
    addModule({ projectRoot: project, module: "sse", modulesDir: MODULES });
    expect(existsSync(join(project, "apps/api/src/events/events.controller.ts"))).toBe(true);
    expect(existsSync(join(project, "apps/api/src/events/events.service.ts"))).toBe(true);
    expect(existsSync(join(project, "apps/api/src/events/events.transport.ts"))).toBe(true);
    expect(readFileSync(join(project, "apps/api/src/app.module.ts"), "utf8")).toContain("EventsModule,");
    const apiPkg = JSON.parse(readFileSync(join(project, "apps/api/package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(apiPkg.dependencies["ioredis"]).toBeDefined();
    const envExample = readFileSync(join(project, ".env.example"), "utf8");
    expect(envExample).toContain("SSE_TRANSPORT=memory");
    expect(envExample).toContain("SSE_REDIS_CHANNEL=podokit:events");
    const service = readFileSync(
      join(project, "apps/api/src/events/events.service.ts"),
      "utf8",
    );
    expect(service).toContain("publishAsync(data: unknown)");
    expect(service).toContain("publishLocal(data: unknown)");
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
    const redisService = readFileSync(
      join(project, "apps/api/src/redis/redis.service.ts"),
      "utf8",
    );
    expect(redisService).toContain("redisConnectionOptions(process.env");
    expect(redisService).toContain('readiness?.register("redis"');
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
    const bridge = readFileSync(
      join(project, "apps/api/src/progress/progress.bridge.ts"),
      "utf8",
    );
    expect(bridge).toContain("events.publishLocal");
    expect(bridge).not.toContain("events.publish({");
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

  it("rate-limit composes identity dependencies and wires a global throttler guard", () => {
    const project = generate("fullstack-nest-svelte");
    const result = addModule({ projectRoot: project, module: "rate-limit", modulesDir: MODULES });

    expect(result.added).toContain("redis");
    expect(result.added).toContain("auth");
    expect(result.added).toContain("api-key-auth");
    expect(existsSync(join(project, "apps/api/src/rate-limit/rate-limit.module.ts"))).toBe(true);
    expect(existsSync(join(project, "apps/api/src/rate-limit/rate-limit.identity.ts"))).toBe(true);
    const apiPkg = JSON.parse(readFileSync(join(project, "apps/api/package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(apiPkg.dependencies["@nestjs/throttler"]).toBeDefined();
    const envExample = readFileSync(join(project, ".env.example"), "utf8");
    expect(envExample).toContain("RATE_LIMIT_MAX");
    expect(envExample).toContain("RATE_LIMIT_AUTH_MAX");
    expect(envExample).toContain("RATE_LIMIT_RUNTIME_MAX");
    expect(envExample).toContain("RATE_LIMIT_TRUSTED_PROXY_HOPS");
    expect(readFileSync(join(project, "apps/api/src/app.module.ts"), "utf8")).toContain("RateLimitModule,");
    const rateLimitModule = readFileSync(join(project, "apps/api/src/rate-limit/rate-limit.module.ts"), "utf8");
    expect(rateLimitModule).toContain("ProxyAwareThrottlerGuard");
    expect(rateLimitModule).toContain('["/health", "/health/ready"]');
    expect(rateLimitModule).toContain("unthrottledHealthPaths.has(path)");
    expect(rateLimitModule).toContain('path.startsWith("/api/auth/")');
    expect(rateLimitModule).toContain('path === "/site/settings"');
    expect(rateLimitModule).toContain("RATE_LIMIT_EXCEEDED");
    expect(rateLimitModule).toContain("RATE_LIMIT_UNAVAILABLE");
    expect(rateLimitModule).not.toContain("static register");
    expect(rateLimitModule).toContain("ThrottlerStorageRedisService(redis.client)");
    expect(rateLimitModule).not.toContain("new Redis");
    const identity = readFileSync(
      join(project, "apps/api/src/rate-limit/rate-limit.identity.ts"),
      "utf8",
    );
    expect(identity).toContain("authRuntime.api.getSession");
    expect(identity).toContain('request.header("x-api-key")');
    expect(identity).toContain("RateLimitIdentityExtension");
    expect(identity).toContain("additionalApiKeyIdentity");
  });

  it("adopts explicitly managed Redis and rate-limit implementations", () => {
    const project = generate("fullstack-nest-svelte");
    const redisPath = "apps/api/src/redis/redis.module.ts";
    const identityPath = "apps/api/src/rate-limit/rate-limit.identity.ts";
    writeFile(join(project, redisPath), "export const legacyRedis = true;\n");
    writeFile(join(project, identityPath), "export const legacyIdentity = true;\n");

    expect(() =>
      addModule({ projectRoot: project, module: "rate-limit", modulesDir: MODULES }),
    ).toThrow("already exists outside PodoKit ownership");

    const adoptedProject = generate("fullstack-nest-svelte");
    writeFile(join(adoptedProject, redisPath), "export const legacyRedis = true;\n");
    writeFile(join(adoptedProject, identityPath), "export const legacyIdentity = true;\n");
    const result = addModule({
      projectRoot: adoptedProject,
      module: "rate-limit",
      modulesDir: MODULES,
      adopt: true,
    });

    expect(result.adopted).toEqual(
      expect.arrayContaining([redisPath, identityPath]),
    );
    expect(readFileSync(join(adoptedProject, redisPath), "utf8")).toContain(
      "export class RedisModule",
    );
    expect(
      readFileSync(join(adoptedProject, identityPath), "utf8"),
    ).toContain("export class RateLimitIdentity");
    expect(readFilesLock(adoptedProject)?.files[redisPath].tier).toBe("managed");
    expect(readFilesLock(adoptedProject)?.files[identityPath].tier).toBe(
      "managed",
    );
  });

  it("api-key-auth composes auth and wires a machine controller", () => {
    const project = generate("fullstack-nest-svelte");
    const result = addModule({ projectRoot: project, module: "api-key-auth", modulesDir: MODULES });

    expect(result.added).toContain("auth");
    expect(existsSync(join(project, "apps/api/src/api-key/api-key.guard.ts"))).toBe(true);
    expect(existsSync(join(project, "apps/api/src/api-key/api-key-verifier.ts"))).toBe(true);
    expect(readFileSync(join(project, ".env.example"), "utf8")).toContain("API_KEYS");
    expect(readFileSync(join(project, "apps/api/src/app.module.ts"), "utf8")).toContain("ApiKeyModule,");
  });

  it("admin-dashboard composes auth and overlays the dashboard UI + admin plugin", () => {
    const project = generate("fullstack-nest-svelte");
    const result = addModule({ projectRoot: project, module: "admin-dashboard", modulesDir: MODULES });

    expect(result.added).toContain("auth");
    const backendProxy = readFileSync(
      join(project, "apps/web/src/lib/server/backend-proxy.ts"),
      "utf8",
    );
    expect(backendProxy).toContain("export function resolveClientIp");
    expect(
      readFileSync(join(project, "apps/web/src/lib/server/api.ts"), "utf8"),
    ).toContain("resolveClientIp(event.getClientAddress)");
    // web overlay
    expect(existsSync(join(project, "apps/web/src/hooks.server.ts"))).toBe(true);
    expect(existsSync(join(project, "apps/web/src/routes/(auth)/login/+page.svelte"))).toBe(true);
    expect(existsSync(join(project, "apps/web/src/routes/(admin)/+layout.svelte"))).toBe(true);
    expect(existsSync(join(project, "apps/web/src/routes/(app)/+layout.server.ts"))).toBe(true);
    expect(existsSync(join(project, "apps/web/src/routes/(app)/+layout.svelte"))).toBe(false);
    expect(existsSync(join(project, "apps/web/src/lib/components/admin-sidebar.svelte"))).toBe(true);
    expect(existsSync(join(project, "apps/web/src/lib/components/app-sidebar.svelte"))).toBe(false);
    expect(existsSync(join(project, "apps/web/src/lib/components/ui/sidebar/index.ts"))).toBe(true);
    // Public routes remain app-owned, while the managed runtime applies global
    // branding and theme settings through the starter layout's stable slot.
    expect(result.preserved).toEqual(expect.arrayContaining(["apps/web/src/routes/+page.svelte"]));
    const landingPage = readFileSync(join(project, "apps/web/src/routes/+page.svelte"), "utf8");
    expect(landingPage).toContain("API health");
    expect(landingPage).toContain('import AccountMenu from "$lib/components/account-menu.svelte";');
    expect(landingPage).toContain('import LanguageSwitch from "$lib/components/language-switch.svelte";');
    expect(landingPage).toContain('import ThemeToggle from "$lib/components/theme-toggle.svelte";');
    expect(landingPage).toContain("<LanguageSwitch />");
    expect(landingPage).toContain("<ThemeToggle />");
    expect(landingPage).toContain("<AccountMenu user={page.data.user ?? null} />");
    const accountMenu = readFileSync(
      join(project, "apps/web/src/lib/components/account-menu.svelte"),
      "utf8",
    );
    expect(accountMenu).toContain('variant?: "avatar" | "identity"');
    expect(accountMenu).toContain('variant === "identity"');
    expect(accountMenu).not.toContain('from "$lib/components/ui/sidebar"');
    const playwrightConfig = readFileSync(join(project, "tests/playwright.config.ts"), "utf8");
    expect(playwrightConfig).toContain("loadPlaywrightProjects(coreProjects)");
    expect(playwrightConfig).toContain('teardown: "cleanup"');
    const seedSetup = readFileSync(join(project, "tests/seed.setup.ts"), "utf8");
    expect(seedSetup).toContain('name: "locale"');
    expect(seedSetup).toContain('value: "en"');
    expect(seedSetup).toContain("mkdirSync(dirname(adminState), { recursive: true })");
    const disposableUsers = readFileSync(
      join(project, "tests/helpers/disposable-users.ts"),
      "utf8",
    );
    expect(disposableUsers).toContain("async ({ context }, use)");
    expect(disposableUsers).toContain("const request = context.request");
    expect(disposableUsers).toContain("headers: origin");
    expect(disposableUsers).not.toContain("signInAdmin");
    const usersCrudSpec = readFileSync(
      join(project, "tests/ui/users-crud.ui.spec.ts"),
      "utf8",
    );
    expect(usersCrudSpec).toContain(
      'getByRole("navigation", { name: "pagination" }).first()',
    );
    const seedTeardown = readFileSync(join(project, "tests/seed.teardown.ts"), "utf8");
    expect(seedTeardown).toContain("if (!existsSync(userBaselineState)) return");
    expect(readFileSync(join(project, "apps/web/src/lib/components/site-runtime.svelte"), "utf8")).toContain("applyTheme");
    const hooks = readFileSync(join(project, "apps/web/src/hooks.server.ts"), "utf8");
    expect(hooks).toContain("event.route.id === null");
    expect(hooks).toContain('/(<html\\b[^>]*?\\slang=)(["\'])[^"\']*\\2/i');
    expect(hooks).toContain("event.locals.authUnavailable = false");
    expect(hooks).toContain("error.status !== 401");
    expect(hooks).toContain("event.locals.siteUnavailable = false");
    expect(hooks).toContain("isTemporaryServiceFailure(cause)");
    expect(hooks).toContain("cause.statusCode === 408 || cause.statusCode === 429 || cause.statusCode >= 500");
    expect(hooks).toContain('error(503, "Service temporarily unavailable")');
    expect(hooks.indexOf('error(503, "Service temporarily unavailable")')).toBeLessThan(
      hooks.lastIndexOf("const response = await resolve(event"),
    );
    const appTypes = readFileSync(join(project, "apps/web/src/app.d.ts"), "utf8");
    expect(appTypes).toContain("authUnavailable: boolean");
    expect(appTypes).toContain("siteUnavailable: boolean");
    const rootLayout = readFileSync(join(project, "apps/web/src/routes/+layout.server.ts"), "utf8");
    expect(rootLayout.indexOf("requireBackendAvailable(locals)")).toBeLessThan(
      rootLayout.indexOf("redirect(303, `/login?redirect="),
    );
    const guards = readFileSync(join(project, "apps/web/src/lib/server/guards.ts"), "utf8");
    expect(guards).toContain('error(503, "Service temporarily unavailable")');
    expect(guards).toContain("export function isPublicPath");
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
    const apiPkg = JSON.parse(readFileSync(join(project, "apps/api/package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(apiPkg.dependencies["image-size"]).toBe("^2.0.2");
    expect(apiPkg.devDependencies["@types/multer"]).toBe("^1.4.12");
    expect(apiPkg.scripts["admin:bootstrap"]).toBe("node scripts/bootstrap-admin.mjs");
    expect(existsSync(join(project, "apps/api/src/profile-image/profile-image.module.ts"))).toBe(true);
    expect(readFileSync(join(project, "apps/api/src/app.module.ts"), "utf8")).toContain(
      "ProfileImageModule,",
    );
    expect(existsSync(join(project, "apps/api/scripts/bootstrap-admin.mjs"))).toBe(true);
    expect(readManifest(project)?.managedOverrides).toContain(
      ".claude/skills/podokit-configure-auth/**",
    );
    expect(readManifest(project)?.managedOverrides).toContain(
      "apps/web/src/routes/(admin)/admin/users/+page.server.ts",
    );
    expect(readManifest(project)?.managedOverrides).toContain(
      "apps/web/src/lib/components/ui/input/input.svelte",
    );
    expect(
      readFilesLock(project)?.files[
        ".claude/skills/podokit-configure-auth/SKILL.md"
      ]?.tier,
    ).toBe("managed");
    expect(
      readFilesLock(project)?.files[
        "apps/web/src/routes/(admin)/admin/users/+page.server.ts"
      ]?.tier,
    ).toBe("managed");
    expect(
      readFilesLock(project)?.files[
        "apps/web/src/lib/components/ui/input/input.svelte"
      ]?.tier,
    ).toBe("managed");
    expect(readFilesLock(project)?.files["apps/web/src/routes/+layout.server.ts"]?.tier).toBe(
      "owned",
    );
    expect(
      readManifest(project)?.modules.find((module) => module.name === "admin-dashboard")
        ?.appliedMigrations,
    ).toContain("admin-route-group");
    expect(readFileSync(join(project, "AGENTS.md"), "utf8")).toContain(
      "The `(admin)` route group and `admin-sidebar.svelte` are the admin-console shell",
    );
  });

  it("rejects a project without the target app", () => {
    const empty = tmp(); // no apps/api/package.json
    expect(() => addModule({ projectRoot: empty, module: "auth", modulesDir: MODULES })).toThrow(
      /does not look like a PodoKit project/,
    );
  });
});
