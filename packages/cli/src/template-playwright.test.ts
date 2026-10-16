import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FullConfig, PlaywrightTestConfig } from "@playwright/test";
import { afterEach, describe, expect, it } from "vitest";
import checkWorkers, {
  e2eWorkers,
  withExclusivePhase,
} from "../../../templates/fullstack/tests/playwright.extensions";

type Projects = NonNullable<PlaywrightTestConfig["projects"]>;
type Project = Projects[number];

const REPO_ROOT = resolve(process.cwd(), "..", "..");

const adminProjects: Projects = [
  { name: "api", testMatch: /.*\.api\.spec\.ts/, dependencies: ["setup"] },
  { name: "setup", testMatch: /.*\.setup\.ts/, teardown: "cleanup" },
  { name: "cleanup", testMatch: /.*\.teardown\.ts/ },
  { name: "ui", testMatch: /.*\.ui\.spec\.ts/, dependencies: ["setup"], use: { storageState: "admin.json" } },
];

function byName(projects: Projects, name: string): Project {
  const project = projects.find((candidate) => candidate.name === name);
  if (!project) throw new Error(`no project ${name}`);
  return project;
}

/** Whether Playwright would run a test with this grep title (title path and tags) in `project`. */
function runs(project: Project, title: string): boolean {
  const list = (value: RegExp | RegExp[] | undefined): RegExp[] =>
    value === undefined ? [] : Array.isArray(value) ? value : [value];
  const grep = list(project.grep);
  const included = grep.length === 0 || grep.some((pattern) => pattern.test(title));
  return included && !list(project.grepInvert).some((pattern) => pattern.test(title));
}

describe("generated Playwright exclusive phase", () => {
  const savedWorkers = process.env.E2E_WORKERS;
  afterEach(() => {
    if (savedWorkers === undefined) delete process.env.E2E_WORKERS;
    else process.env.E2E_WORKERS = savedWorkers;
  });

  it("reads the worker count from E2E_WORKERS and defaults to one", () => {
    expect(e2eWorkers(undefined)).toBe(1);
    expect(e2eWorkers(" ")).toBe(1);
    expect(e2eWorkers("3")).toBe(3);
    for (const invalid of ["0", "-1", "1.5", "two", "50%"]) {
      expect(() => e2eWorkers(invalid), invalid).toThrow(/E2E_WORKERS must be a whole number/);
    }
  });

  it("splits each test project into a shared project and a one-worker exclusive twin", () => {
    const projects = withExclusivePhase(adminProjects, 1);

    expect(projects.map((project) => project.name)).toEqual([
      "api",
      "setup",
      "cleanup",
      "ui",
      "api-exclusive",
      "ui-exclusive",
    ]);
    expect(byName(projects, "setup")).toBe(adminProjects[1]);
    expect(byName(projects, "cleanup")).toBe(adminProjects[2]);
    for (const name of ["api", "ui"]) {
      const shared = byName(projects, name);
      const twin = byName(projects, `${name}-exclusive`);
      expect(shared.workers).toBeUndefined();
      expect(twin.workers).toBe(1);
      expect(twin.testMatch).toEqual(shared.testMatch);
      expect(twin.use).toEqual(shared.use);
      // One worker runs everything in order, so the twins need no dependency
      // on the shared projects and a filtered run stays small.
      expect(twin.dependencies).toEqual(["setup"]);
    }
  });

  it("routes tagged tests to the twins only", () => {
    const projects = withExclusivePhase(adminProjects, 1);
    const tagged = "ui/settings.ui.spec.ts maintenance mode holds visitors back @exclusive";
    const taggedFirst = "api/auth.api.spec.ts flag toggles @exclusive @smoke";
    const plain = "ui/settings.ui.spec.ts settings has General and Authentication tabs";
    const lookalike = "api/x.api.spec.ts @exclusive-ish @smoke";

    for (const name of ["api", "ui"]) {
      const shared = byName(projects, name);
      const twin = byName(projects, `${name}-exclusive`);
      for (const title of [tagged, taggedFirst]) {
        expect(runs(shared, title), `${name} ${title}`).toBe(false);
        expect(runs(twin, title), `${name}-exclusive ${title}`).toBe(true);
      }
      for (const title of [plain, lookalike]) {
        expect(runs(shared, title), `${name} ${title}`).toBe(true);
        expect(runs(twin, title), `${name}-exclusive ${title}`).toBe(false);
      }
    }
  });

  it("orders the twins after every other test project, one after another, with more workers", () => {
    const mobile: Project = {
      name: "mobile",
      testMatch: /.*\.ui\.spec\.ts/,
      dependencies: ["setup"],
    };
    const projects = withExclusivePhase([...adminProjects, mobile], 3);

    expect(byName(projects, "api-exclusive").dependencies).toEqual(["setup", "api", "ui", "mobile"]);
    expect(byName(projects, "ui-exclusive").dependencies).toEqual(["setup", "api-exclusive"]);
    expect(byName(projects, "mobile-exclusive").dependencies).toEqual(["setup", "ui-exclusive"]);
    expect(byName(projects, "api").dependencies).toEqual(["setup"]);
    expect(byName(projects, "mobile").dependencies).toEqual(["setup"]);
  });

  it("keeps an application project's own grep and setup projects", () => {
    const appSetup: Project = { name: "app-setup", testMatch: /app\.setup\.ts/ };
    const app: Project = {
      name: "reports",
      testMatch: /reports\/.*\.spec\.ts/,
      dependencies: ["app-setup"],
      grep: /@reports/,
      grepInvert: /@slow/,
    };
    const projects = withExclusivePhase([...adminProjects, appSetup, app], 2);

    expect(byName(projects, "app-setup")).toBe(appSetup);
    expect(projects.some((project) => project.name === "app-setup-exclusive")).toBe(false);
    const shared = byName(projects, "reports");
    const twin = byName(projects, "reports-exclusive");
    expect(runs(shared, "reports/a.spec.ts totals @reports")).toBe(true);
    expect(runs(shared, "reports/a.spec.ts totals @reports @exclusive")).toBe(false);
    expect(runs(shared, "reports/a.spec.ts totals @reports @slow")).toBe(false);
    expect(runs(twin, "reports/a.spec.ts totals @reports @exclusive")).toBe(true);
    expect(runs(twin, "reports/a.spec.ts totals @exclusive")).toBe(false);
    expect(runs(twin, "reports/a.spec.ts totals @reports @exclusive @slow")).toBe(false);
    expect(runs(twin, "reports/a.spec.ts totals @reports")).toBe(false);
    expect(twin.dependencies).toEqual(["app-setup", "ui-exclusive"]);
  });

  it("refuses a twin name that another project already uses", () => {
    expect(() =>
      withExclusivePhase([...adminProjects, { name: "ui-exclusive", testMatch: /x\.spec\.ts/ }], 1),
    ).toThrow("Duplicate Playwright project name: ui-exclusive");
  });

  it("refuses --workers above one unless E2E_WORKERS orders the exclusive phase", () => {
    const config = (workers: number): FullConfig => ({ workers }) as FullConfig;

    delete process.env.E2E_WORKERS;
    expect(() => checkWorkers(config(1))).not.toThrow();
    expect(() => checkWorkers(config(2))).toThrow("Set the worker count with E2E_WORKERS=2 instead of --workers.");
    process.env.E2E_WORKERS = "2";
    expect(() => checkWorkers(config(2))).not.toThrow();
    expect(() => checkWorkers(config(4))).not.toThrow();
  });

  it("builds both managed configs from E2E_WORKERS with the phase and its guard", () => {
    for (const path of [
      "templates/fullstack/tests/playwright.config.ts",
      "templates/modules/admin-dashboard/files/tests/playwright.config.ts",
    ]) {
      const config = readFileSync(resolve(REPO_ROOT, path), "utf8");
      expect(config, path).toContain("const workers = e2eWorkers();");
      expect(config, path).toContain("  workers,\n");
      expect(config, path).toContain('globalSetup: "./playwright.extensions.ts",');
      expect(config, path).toContain(
        "projects: withExclusivePhase([...coreProjects, ...loadPlaywrightProjects(coreProjects)], workers),",
      );
    }
    const scripts = (
      JSON.parse(readFileSync(resolve(REPO_ROOT, "templates/fullstack/tests/package.json"), "utf8")) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    expect(scripts["test:e2e:api"]).toBe("bunx playwright test --project=api --project=api-exclusive");
    expect(scripts["test:e2e:ui"]).toBe("bunx playwright test --project=ui --project=ui-exclusive");
  });
});
