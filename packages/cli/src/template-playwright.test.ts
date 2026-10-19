import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FullConfig, PlaywrightTestConfig } from "@playwright/test";
import { afterEach, describe, expect, it } from "vitest";
import checkWorkers, {
  e2ePhase,
  e2eRuns,
  e2eRunSettings,
  e2eTrace,
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

/** Whether Playwright would collect a test file in `project` at all. */
function collects(project: Project, file: string): boolean {
  const list = (value: Project["testIgnore"]): Array<string | RegExp> =>
    value === undefined ? [] : Array.isArray(value) ? value : [value];
  return !list(project.testIgnore).some((pattern) => (typeof pattern === "string" ? file === pattern : pattern.test(file)));
}

describe("generated Playwright exclusive phase", () => {
  const savedWorkers = process.env.E2E_WORKERS;
  const savedPhase = process.env.E2E_PHASE;
  afterEach(() => {
    if (savedWorkers === undefined) delete process.env.E2E_WORKERS;
    else process.env.E2E_WORKERS = savedWorkers;
    if (savedPhase === undefined) delete process.env.E2E_PHASE;
    else process.env.E2E_PHASE = savedPhase;
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

  it("runs the exclusive tests in a second Playwright run with more workers, whatever the first run does", () => {
    expect(e2eRuns([], 1)).toEqual([{ args: [] }]);
    expect(e2eRuns(["--grep", "@smoke"], 1)).toEqual([{ args: ["--grep", "@smoke"] }]);
    expect(e2eRuns([], 2)).toEqual([
      { phase: "shared", args: [] },
      { phase: "exclusive", args: ["--pass-with-no-tests"] },
    ]);
    expect(e2eRuns(["--project=ui", "--project=ui-exclusive"], 3)).toEqual([
      { phase: "shared", args: ["--pass-with-no-tests", "--project=ui", "--project=ui-exclusive"] },
      { phase: "exclusive", args: ["--pass-with-no-tests", "--project=ui", "--project=ui-exclusive"] },
    ]);
  });

  it("splits the projects between the two runs without a dependency on the other tests", () => {
    const file = "/app/tests/ui/settings.ui.spec.ts";
    const first = withExclusivePhase(adminProjects, 2, "shared");
    const second = withExclusivePhase(adminProjects, 1, "exclusive");

    for (const name of ["api", "ui"]) {
      expect(collects(byName(first, name), file), `shared ${name}`).toBe(true);
      expect(collects(byName(first, `${name}-exclusive`), file), `shared ${name}-exclusive`).toBe(false);
      expect(collects(byName(second, name), file), `exclusive ${name}`).toBe(false);
      expect(collects(byName(second, `${name}-exclusive`), file), `exclusive ${name}-exclusive`).toBe(true);
      expect(byName(first, `${name}-exclusive`).dependencies).toEqual(["setup"]);
      expect(byName(second, `${name}-exclusive`).dependencies).toEqual(["setup"]);
      expect(runs(byName(second, `${name}-exclusive`), "settings maintenance mode @exclusive")).toBe(true);
    }
    for (const name of ["setup", "cleanup"]) {
      expect(byName(first, name)).toBe(byName(adminProjects, name));
      expect(byName(second, name)).toBe(byName(adminProjects, name));
    }
  });

  it("runs the exclusive phase on one worker with its own results and report", () => {
    expect(e2eRunSettings(undefined, 2)).toEqual({
      phase: undefined,
      workers: 2,
      outputDir: "test-results",
      reportFolder: "playwright-report",
    });
    expect(e2eRunSettings("shared", 2)).toEqual({
      phase: "shared",
      workers: 2,
      outputDir: "test-results",
      reportFolder: "playwright-report",
    });
    expect(e2eRunSettings("exclusive", 2)).toEqual({
      phase: "exclusive",
      workers: 1,
      outputDir: "test-results/exclusive",
      reportFolder: "playwright-report/exclusive",
    });
    expect(e2ePhase(undefined)).toBeUndefined();
    expect(e2ePhase("")).toBeUndefined();
    expect(e2ePhase("exclusive")).toBe("exclusive");
    expect(() => e2ePhase("both")).toThrow('E2E_PHASE must be "shared" or "exclusive", got "both".');
  });

  it("orders the twins after every other test project, one after another, in a single run with more workers", () => {
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
    expect(() => checkWorkers(config(2), () => undefined)).not.toThrow();
    expect(() => checkWorkers(config(4), () => undefined)).not.toThrow();
  });

  it("warns when more than one worker runs the suite in a single Playwright run", () => {
    const config = (workers: number): FullConfig => ({ workers }) as FullConfig;
    const warnings: string[] = [];
    const warn = (message: string): void => {
      warnings.push(message);
    };

    process.env.E2E_WORKERS = "2";
    delete process.env.E2E_PHASE;
    checkWorkers(config(2), warn);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("a failing test makes Playwright skip the tests tagged @exclusive");
    process.env.E2E_PHASE = "shared";
    checkWorkers(config(2), warn);
    process.env.E2E_PHASE = "exclusive";
    checkWorkers(config(1), warn);
    delete process.env.E2E_WORKERS;
    delete process.env.E2E_PHASE;
    checkWorkers(config(1), warn);
    expect(warnings).toHaveLength(1);
  });

  it("builds both managed configs from E2E_WORKERS with the phase and its guard", () => {
    for (const path of [
      "templates/fullstack/tests/playwright.config.ts",
      "templates/modules/admin-dashboard/files/tests/playwright.config.ts",
    ]) {
      const config = readFileSync(resolve(REPO_ROOT, path), "utf8");
      expect(config, path).toContain("const run = e2eRunSettings();");
      expect(config, path).toContain("  workers: run.workers,\n  outputDir: run.outputDir,\n");
      expect(config, path).toContain('globalSetup: "./playwright.extensions.ts",');
      expect(config, path).toContain('["html", { open: "never", outputFolder: run.reportFolder }]');
      expect(config, path).toContain(
        "projects: withExclusivePhase([...coreProjects, ...loadPlaywrightProjects(coreProjects)], run.workers, run.phase),",
      );
    }
    const scripts = (
      JSON.parse(readFileSync(resolve(REPO_ROOT, "templates/fullstack/tests/package.json"), "utf8")) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    expect(scripts["test:e2e"]).toBe("bun run-e2e.ts");
    expect(scripts["test:e2e:api"]).toBe("bun run-e2e.ts --project=api --project=api-exclusive");
    expect(scripts["test:e2e:ui"]).toBe("bun run-e2e.ts --project=ui --project=ui-exclusive");
  });

  it("records traces only when asked, or on a CI retry", () => {
    // A trace of every test, kept only for failures, slowed the UI tests on the
    // Vite dev server; locally a failed file is rerun with E2E_TRACE instead.
    expect(e2eTrace(undefined, false)).toBe("off");
    expect(e2eTrace(" ", false)).toBe("off");
    expect(e2eTrace(undefined, true)).toBe("on-first-retry");
    expect(e2eTrace("retain-on-failure", false)).toBe("retain-on-failure");
    expect(e2eTrace("on", true)).toBe("on");
    expect(e2eTrace("off", true)).toBe("off");
    expect(() => e2eTrace("always", false)).toThrow(
      'E2E_TRACE must be one of off, on, retain-on-failure, on-first-retry, on-all-retries, retain-on-first-failure, retain-on-failure-and-retries, got "always".',
    );
    for (const path of [
      "templates/fullstack/tests/playwright.config.ts",
      "templates/modules/admin-dashboard/files/tests/playwright.config.ts",
    ]) {
      const config = readFileSync(resolve(REPO_ROOT, path), "utf8");
      expect(config, path).toMatch(/\btrace: e2eTrace\(\),/);
      expect(config, path).not.toMatch(/\btrace: "/);
      expect(config, path).toContain('screenshot: "only-on-failure"');
      expect(config, path).toContain("retries: process.env.CI ? 2 : 0,");
    }
  });
});
