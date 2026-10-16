import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { create } from "./create";
import { addModule } from "./add";
import { readFilesLock } from "./lockfile";

const REPO_TEMPLATES = resolve(process.cwd(), "..", "..", "templates");
const ADMIN_HELPERS = join(REPO_TEMPLATES, "modules/admin-dashboard/files/tests/helpers");

function specFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "node_modules" ? [] : specFiles(path);
    return /\/tests\/.*\.ts$/.test(path) ? [path] : [];
  });
}

describe("managed e2e specs", () => {
  it("name the seeded accounts only through the account helpers", () => {
    const offenders = specFiles(REPO_TEMPLATES)
      .filter((path) => !/\/tests\/helpers\/(app-)?accounts\.ts$/.test(path))
      .flatMap((path) =>
        readFileSync(path, "utf8")
          .split("\n")
          .map((line, index) => ({ line, at: `${relative(REPO_TEMPLATES, path)}:${index + 1}` }))
          .filter(({ line }) => /(admin|user)@example\.com/.test(line) && !/E2E_ADMIN_EMAIL \|\|/.test(line))
          .map(({ at }) => at),
      );
    expect(offenders).toEqual([]);
  });

  it("make the application seams owned and the helpers that read them managed", () => {
    const parent = mkdtempSync(join(tmpdir(), "podokit-template-specs-"));
    try {
      const dir = join(parent, "app");
      create({ name: "app", template: "fullstack", templatesDir: REPO_TEMPLATES, targetDir: dir });
      addModule({ projectRoot: dir, module: "admin-dashboard", modulesDir: join(REPO_TEMPLATES, "modules") });
      const files = readFilesLock(dir)!.files;
      expect(files["tests/helpers/app-paths.ts"]?.tier).toBe("owned");
      expect(files["tests/helpers/app-accounts.ts"]?.tier).toBe("owned");
      expect(files["tests/helpers/paths.ts"]?.tier).toBe("managed");
      expect(files["tests/helpers/accounts.ts"]?.tier).toBe("managed");
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

describe("seeded accounts", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.resetModules();
    vi.doUnmock(join(ADMIN_HELPERS, "app-accounts.ts"));
  });

  it("take E2E_* variables first, then app-accounts.ts, then the defaults", async () => {
    vi.doMock(join(ADMIN_HELPERS, "app-accounts.ts"), () => ({
      appAccounts: { admin: { email: "owner@example.org", password: "from-app" }, user: { name: "Member" } },
    }));
    process.env.E2E_ADMIN_PASSWORD = "from-env";
    delete process.env.E2E_ADMIN_EMAIL;
    delete process.env.E2E_USER_EMAIL;
    delete process.env.E2E_USER_PASSWORD;
    const { ADMIN, USER } = await import(join(ADMIN_HELPERS, "accounts.ts"));
    expect(ADMIN).toEqual({ name: "Admin", email: "owner@example.org", password: "from-env" });
    expect(USER).toEqual({ name: "Member", email: "user@example.com", password: "Podokit3e-Str0ng!pw" });
  });
});
