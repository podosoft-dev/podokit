import { afterEach, describe, expect, it } from "vitest";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { create } from "./create";
import { addModule } from "./add";
import { removeModule } from "./remove";
import { applyUpdate, planUpdate } from "./update";
import { initializeDeploymentProfile, loadDeploymentProfile } from "./deploy-profile";
import { initializeComposeProfile, parseComposeProfile } from "./deploy-compose-profile";
import { mergeApiPaths, parseApiPaths } from "./api-paths";
import { readManifest } from "./lockfile";

const REPO_TEMPLATES = resolve(process.cwd(), "..", "..", "templates");
const MODULES = join(REPO_TEMPLATES, "modules");
const UPLOADS = "/api/files/uploads/";
const FINGERPRINT = `sha256:${"a".repeat(64)}`;

const created: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "podokit-api-paths-"));
  created.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function generate(templatesDir = REPO_TEMPLATES): string {
  const target = join(tmp(), "app");
  create({ name: "app", template: "fullstack", templatesDir, targetDir: target });
  return target;
}

function readJson(project: string, file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(project, file), "utf8")) as Record<string, unknown>;
}

function devApiPaths(project: string): unknown {
  return readJson(project, ".podokit/dev.json").apiPaths;
}

function profileApiPaths(project: string, name: string): unknown {
  return (readJson(project, `.podokit/deploy/${name}.json`).exposure as Record<string, unknown>).apiPaths;
}

function kubernetesProfile(project: string, name = "production"): void {
  initializeDeploymentProfile(project, name, { context: name, clusterFingerprint: FINGERPRINT });
}

function composeProfile(project: string, name = "compose"): void {
  initializeComposeProfile(project, name, { context: name, endpointFingerprint: FINGERPRINT });
}

function editJson(project: string, file: string, edit: (value: Record<string, unknown>) => void): void {
  const value = readJson(project, file);
  edit(value);
  writeFile(join(project, file), `${JSON.stringify(value, null, 2)}\n`);
}

/** An installed external module that declares the given direct API paths. */
function packageModule(project: string, name: string, apiPaths: unknown): void {
  const dir = join(project, "node_modules", "@podosoft", `podokit-module-${name}`);
  writeFile(join(dir, "package.json"), JSON.stringify({ name: `@podosoft/podokit-module-${name}`, version: "1.0.0" }));
  writeFile(
    join(dir, "module.manifest.json"),
    JSON.stringify({ manifestVersion: 4, name, description: name, targetApp: "api", apiPaths }),
  );
}

function appliedApiPaths(project: string, module: string): string[] | undefined {
  return readManifest(project)?.modules.find((entry) => entry.name === module)?.appliedApiPaths;
}

describe("mergeApiPaths", () => {
  const validate = (paths: string[]): void => {
    parseApiPaths(paths, "apiPaths", ["/api/events/ws"]);
  };

  it("appends new paths and leaves covered ones alone", () => {
    const merge = mergeApiPaths(["/api/files/"], [UPLOADS, "/api/import"], validate);
    expect(merge.paths).toEqual(["/api/files/", "/api/import"]);
    expect(merge.added).toEqual(["/api/import"]);
    expect(merge.rejected).toEqual([]);
  });

  it("rejects a path that would cover an entry or a WebSocket path", () => {
    const merge = mergeApiPaths([UPLOADS], ["/api/files", "/api/events/"], validate);
    expect(merge.paths).toEqual([UPLOADS]);
    expect(merge.rejected.map((entry) => entry.path)).toEqual(["/api/files", "/api/events/"]);
    expect(merge.rejected[0]?.reason).toContain("overlapping paths");
    expect(merge.rejected[1]?.reason).toContain('covers WebSocket path "/api/events/ws"');
  });
});

describe("podo add with module apiPaths", () => {
  it("merges the module's paths into dev.json, keeping its keys and formatting", () => {
    const project = generate();
    editJson(project, ".podokit/dev.json", (config) => {
      delete config.apiPaths;
      config.publicUrl = "https://app.example.com";
    });
    const keys = Object.keys(readJson(project, ".podokit/dev.json"));

    const result = addModule({ projectRoot: project, module: "file-upload", modulesDir: MODULES });

    expect(result.apiPaths.changed).toEqual([
      { module: "file-upload", path: UPLOADS, file: ".podokit/dev.json" },
    ]);
    expect(result.apiPaths.skipped).toEqual([]);
    const text = readFileSync(join(project, ".podokit/dev.json"), "utf8");
    expect(text).toBe(
      `${JSON.stringify({ ...readJson(project, ".podokit/dev.json") }, null, 2)}\n`,
    );
    expect(Object.keys(JSON.parse(text) as object)).toEqual([...keys, "apiPaths"]);
    expect(devApiPaths(project)).toEqual([UPLOADS]);
    expect(appliedApiPaths(project, "file-upload")).toEqual([UPLOADS]);
    expect(appliedApiPaths(project, "object-storage-s3")).toBeUndefined();
  });

  it("adds the paths to every deployment profile and reports profiles it cannot change", () => {
    const project = generate();
    kubernetesProfile(project);
    kubernetesProfile(project, "edge");
    editJson(project, ".podokit/deploy/edge.json", (profile) => {
      (profile.exposure as Record<string, unknown>).mode = "nodePort";
    });
    composeProfile(project);
    const edge = readFileSync(join(project, ".podokit/deploy/edge.json"), "utf8");

    const result = addModule({ projectRoot: project, module: "file-upload", modulesDir: MODULES });

    expect(result.apiPaths.changed.map((change) => change.file)).toEqual([
      ".podokit/dev.json",
      ".podokit/deploy/compose.json",
      ".podokit/deploy/production.json",
    ]);
    expect(result.apiPaths.skipped).toEqual([
      {
        module: "file-upload",
        path: UPLOADS,
        file: ".podokit/deploy/edge.json",
        reason: "Deployment exposure.apiPaths requires exposure.mode ingress.",
      },
    ]);
    expect(readFileSync(join(project, ".podokit/deploy/edge.json"), "utf8")).toBe(edge);
    expect(loadDeploymentProfile(project, "production").exposure.apiPaths).toEqual([UPLOADS]);
    expect(parseComposeProfile(readJson(project, ".podokit/deploy/compose.json")).exposure.apiPaths)
      .toEqual([UPLOADS]);
  });

  it("is idempotent and keeps entries that already cover the path", () => {
    const project = generate();
    kubernetesProfile(project);
    editJson(project, ".podokit/deploy/production.json", (profile) => {
      (profile.exposure as Record<string, unknown>).apiPaths = ["/api/files"];
    });

    addModule({ projectRoot: project, module: "file-upload", modulesDir: MODULES });
    const again = addModule({ projectRoot: project, module: "file-upload", modulesDir: MODULES });

    expect(again.apiPaths).toEqual({ changed: [], skipped: [] });
    expect(devApiPaths(project)).toEqual([UPLOADS]);
    expect(profileApiPaths(project, "production")).toEqual(["/api/files"]);
    expect(appliedApiPaths(project, "file-upload")).toEqual([UPLOADS]);
  });

  it("never adds a path that would cover a WebSocket path", () => {
    const project = generate();
    editJson(project, ".podokit/dev.json", (config) => {
      config.webSocketPaths = ["/api/files/uploads/live"];
    });
    const before = readFileSync(join(project, ".podokit/dev.json"), "utf8");

    const result = addModule({ projectRoot: project, module: "file-upload", modulesDir: MODULES });

    expect(result.apiPaths.changed).toEqual([]);
    expect(result.apiPaths.skipped[0]?.reason).toContain(
      'covers WebSocket path "/api/files/uploads/live"',
    );
    expect(readFileSync(join(project, ".podokit/dev.json"), "utf8")).toBe(before);
  });

  it("reports a missing dev.json without creating it", () => {
    const project = generate();
    rmSync(join(project, ".podokit/dev.json"));

    const result = addModule({ projectRoot: project, module: "file-upload", modulesDir: MODULES });

    expect(result.apiPaths.skipped).toEqual([
      { module: "file-upload", path: UPLOADS, file: ".podokit/dev.json", reason: "the file does not exist" },
    ]);
    expect(existsSync(join(project, ".podokit/dev.json"))).toBe(false);
  });

  it("rejects a manifest with invalid apiPaths before changing the project", () => {
    const project = generate();
    packageModule(project, "auth-route", ["/api/auth/callback/"]);
    packageModule(project, "outside", ["/files/"]);
    const app = readFileSync(join(project, "apps/api/src/app.ts"), "utf8");

    expect(() => addModule({ projectRoot: project, module: "auth-route", modulesDir: MODULES }))
      .toThrow(/Module "auth-route" declares invalid apiPaths\..*authentication routes/);
    expect(() => addModule({ projectRoot: project, module: "outside", modulesDir: MODULES }))
      .toThrow(/Module "outside" declares invalid apiPaths\..*under \/api\//);
    expect(readFileSync(join(project, "apps/api/src/app.ts"), "utf8")).toBe(app);
    expect(devApiPaths(project)).toEqual([]);
    expect(readManifest(project)?.modules).toEqual([]);
  });

  it("gives the same result as create followed by add", () => {
    const project = generate();
    addModule({ projectRoot: project, module: "file-upload", modulesDir: MODULES });

    const plan = planUpdate(project, REPO_TEMPLATES);
    expect(plan.apiPaths).toEqual({ changed: [], skipped: [] });
    expect(plan.changes.find((change) => change.path === ".podokit/dev.json")?.action).toBe("skip");
  });
});

describe("podo deploy init with module apiPaths", () => {
  it("seeds new profiles with the paths installed modules contributed", () => {
    const project = generate();
    addModule({ projectRoot: project, module: "file-upload", modulesDir: MODULES });

    kubernetesProfile(project);
    composeProfile(project);

    expect(profileApiPaths(project, "production")).toEqual([UPLOADS]);
    expect(profileApiPaths(project, "compose")).toEqual([UPLOADS]);
  });

  it("leaves apiPaths empty without such modules", () => {
    const project = generate();
    kubernetesProfile(project);
    expect(profileApiPaths(project, "production")).toEqual([]);
  });
});

describe("podo remove with module apiPaths", () => {
  it("removes only the paths the module contributed", () => {
    const project = generate();
    kubernetesProfile(project);
    addModule({ projectRoot: project, module: "file-upload", modulesDir: MODULES });
    editJson(project, ".podokit/dev.json", (config) => {
      config.apiPaths = ["/api/import/", UPLOADS];
    });

    const result = removeModule({ projectRoot: project, module: "file-upload", modulesDir: MODULES });

    expect(result.apiPaths.changed).toEqual([
      { module: "file-upload", path: UPLOADS, file: ".podokit/dev.json" },
      { module: "file-upload", path: UPLOADS, file: ".podokit/deploy/production.json" },
    ]);
    expect(devApiPaths(project)).toEqual(["/api/import/"]);
    expect(profileApiPaths(project, "production")).toEqual([]);
  });

  it("keeps a path another installed module still declares", () => {
    const project = generate();
    addModule({ projectRoot: project, module: "file-upload", modulesDir: MODULES });
    packageModule(project, "upload-audit", [UPLOADS]);
    addModule({ projectRoot: project, module: "upload-audit", modulesDir: MODULES });

    expect(removeModule({ projectRoot: project, module: "file-upload", modulesDir: MODULES }).apiPaths)
      .toEqual({ changed: [], skipped: [] });
    expect(devApiPaths(project)).toEqual([UPLOADS]);

    removeModule({ projectRoot: project, module: "upload-audit", modulesDir: MODULES });
    expect(devApiPaths(project)).toEqual([]);
  });

  it("keeps a path a Compose profile still needs for its trusted proxies", () => {
    const project = generate();
    composeProfile(project);
    addModule({ projectRoot: project, module: "file-upload", modulesDir: MODULES });
    editJson(project, ".podokit/deploy/compose.json", (profile) => {
      (profile.exposure as Record<string, unknown>).trustedProxyCidrs = ["10.0.0.0/8"];
    });

    const result = removeModule({ projectRoot: project, module: "file-upload", modulesDir: MODULES });

    expect(result.apiPaths.skipped).toEqual([
      expect.objectContaining({
        file: ".podokit/deploy/compose.json",
        path: UPLOADS,
        reason: expect.stringContaining("trustedProxyCidrs requires"),
      }),
    ]);
    expect(profileApiPaths(project, "compose")).toEqual([UPLOADS]);
    expect(devApiPaths(project)).toEqual([]);
  });
});

describe("podo update with module apiPaths", () => {
  /** Templates whose file-upload module predates its apiPaths declaration. */
  function previousTemplates(): string {
    const dir = join(tmp(), "templates");
    cpSync(REPO_TEMPLATES, dir, { recursive: true });
    const manifestPath = join(dir, "modules/file-upload/module.manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    delete manifest.apiPaths;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return dir;
  }

  function previousProject(): string {
    const templates = previousTemplates();
    const project = generate(templates);
    addModule({ projectRoot: project, module: "file-upload", modulesDir: join(templates, "modules") });
    return project;
  }

  it("plans and applies paths a module newly declares", () => {
    const project = previousProject();
    kubernetesProfile(project);
    expect(devApiPaths(project)).toEqual([]);
    expect(profileApiPaths(project, "production")).toEqual([]);

    const plan = planUpdate(project, REPO_TEMPLATES);
    expect(plan.apiPaths.changed).toEqual([
      { module: "file-upload", path: UPLOADS, file: ".podokit/dev.json" },
      { module: "file-upload", path: UPLOADS, file: ".podokit/deploy/production.json" },
    ]);
    expect(devApiPaths(project)).toEqual([]);

    const result = applyUpdate(project, REPO_TEMPLATES);
    expect(result.apiPaths).toEqual(plan.apiPaths);
    expect(devApiPaths(project)).toEqual([UPLOADS]);
    expect(profileApiPaths(project, "production")).toEqual([UPLOADS]);
    expect(appliedApiPaths(project, "file-upload")).toEqual([UPLOADS]);
    expect(planUpdate(project, REPO_TEMPLATES).apiPaths).toEqual({ changed: [], skipped: [] });
  });

  it("does not restore a path the application removed after it was applied", () => {
    const project = previousProject();
    applyUpdate(project, REPO_TEMPLATES);
    editJson(project, ".podokit/dev.json", (config) => {
      config.apiPaths = [];
    });

    expect(planUpdate(project, REPO_TEMPLATES).apiPaths).toEqual({ changed: [], skipped: [] });
    applyUpdate(project, REPO_TEMPLATES);
    expect(devApiPaths(project)).toEqual([]);
  });

  it("adds the paths to a dev.json the update recreates", () => {
    const project = previousProject();
    rmSync(join(project, ".podokit/dev.json"));

    const plan = planUpdate(project, REPO_TEMPLATES);
    expect(plan.changes.find((change) => change.path === ".podokit/dev.json")?.action).toBe("add");
    expect(plan.apiPaths.changed).toEqual([
      { module: "file-upload", path: UPLOADS, file: ".podokit/dev.json" },
    ]);

    applyUpdate(project, REPO_TEMPLATES);
    expect(devApiPaths(project)).toEqual([UPLOADS]);
  });

  it("reports a path it cannot add and records it as offered", () => {
    const project = previousProject();
    editJson(project, ".podokit/dev.json", (config) => {
      config.webSocketPaths = ["/api/files/uploads/live"];
    });

    const plan = planUpdate(project, REPO_TEMPLATES);
    expect(plan.apiPaths.changed).toEqual([]);
    expect(plan.apiPaths.skipped).toEqual([
      expect.objectContaining({ file: ".podokit/dev.json", path: UPLOADS }),
    ]);

    applyUpdate(project, REPO_TEMPLATES);
    expect(devApiPaths(project)).toEqual([]);
    expect(planUpdate(project, REPO_TEMPLATES).apiPaths).toEqual({ changed: [], skipped: [] });
  });
});
