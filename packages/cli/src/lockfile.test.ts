import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  matchGlob,
  classifyTier,
  walkFiles,
  computeFilesLock,
  initLockfile,
  recordModules,
  mergeOwnedGlobs,
  readManifest,
  readFilesLock,
  DEFAULT_OWNED_GLOBS,
  type FilesLock,
} from "./lockfile";

const created: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "podokit-lock-"));
  created.push(dir);
  return dir;
}
function write(root: string, rel: string, content: string): void {
  const path = join(root, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("matchGlob", () => {
  it("matches ** across any depth", () => {
    expect(matchGlob("apps/web/src/routes/x/+page.svelte", "apps/web/src/routes/**")).toBe(true);
    expect(matchGlob("apps/web/src/routes", "apps/web/src/routes/**")).toBe(true);
    expect(matchGlob("apps/api/src/main.ts", "apps/web/src/routes/**")).toBe(false);
  });
  it("matches * within a single segment", () => {
    expect(matchGlob("apps/api/src/x.user.ts", "apps/api/src/*.user.ts")).toBe(true);
    expect(matchGlob("apps/api/src/deep/x.user.ts", "apps/api/src/*.user.ts")).toBe(false);
  });
});

describe("classifyTier", () => {
  it("owned wins by glob", () => {
    expect(classifyTier("apps/web/src/routes/+page.svelte", "anything", DEFAULT_OWNED_GLOBS)).toBe("owned");
  });
  it("assembled when a podokit marker is present", () => {
    expect(classifyTier("apps/api/src/app.module.ts", "// podokit:module-imports", [])).toBe("assembled");
  });
  it("managed otherwise", () => {
    expect(classifyTier("apps/api/src/main.ts", "bootstrap()", [])).toBe("managed");
  });
  it("lets module-managed paths override broad owned globs", () => {
    const path = ".claude/skills/podokit-configure-auth/SKILL.md";
    expect(classifyTier(path, "skill", DEFAULT_OWNED_GLOBS, [
      ".claude/skills/podokit-configure-auth/**",
    ])).toBe("managed");
  });
  it("keeps an explicitly ejected file owned over a managed override", () => {
    const path = ".claude/skills/podokit-configure-auth/SKILL.md";
    expect(classifyTier(path, "skill", [...DEFAULT_OWNED_GLOBS, path], [
      ".claude/skills/podokit-configure-auth/**",
    ])).toBe("owned");
  });
});

describe("walkFiles", () => {
  it("lists files as POSIX paths and skips node_modules/.git/.podokit", () => {
    const root = tmp();
    write(root, "apps/api/src/main.ts", "x");
    write(root, "node_modules/pkg/index.js", "y");
    write(root, ".git/config", "z");
    write(root, ".podokit/manifest.json", "{}");
    expect(walkFiles(root)).toEqual(["apps/api/src/main.ts"]);
  });
});

describe("initLockfile + computeFilesLock", () => {
  it("writes a manifest and a files.lock with classified tiers", () => {
    const root = tmp();
    write(root, "apps/api/src/main.ts", "bootstrap()");
    write(root, "apps/api/src/app.module.ts", "// podokit:module-imports");
    write(root, "apps/web/src/routes/+page.svelte", "<h1/>");

    initLockfile(root, {
      template: "fullstack-nest-svelte",
      packageManager: "npm",
      answers: { projectName: "app", packageManager: "npm" },
      version: "9.9.9",
    });

    const manifest = readManifest(root);
    expect(manifest?.podokitVersion).toBe("9.9.9");
    expect(manifest?.template).toBe("fullstack-nest-svelte");
    expect(manifest?.modules).toEqual([]);
    expect(manifest?.ownedGlobs).toEqual(DEFAULT_OWNED_GLOBS);
    expect(manifest?.managedOverrides).toEqual([]);

    const lock = JSON.parse(readFileSync(join(root, ".podokit/files.lock"), "utf8")) as FilesLock;
    expect(lock.files["apps/api/src/main.ts"].tier).toBe("managed");
    expect(lock.files["apps/api/src/app.module.ts"].tier).toBe("assembled");
    expect(lock.files["apps/web/src/routes/+page.svelte"].tier).toBe("owned");
    expect(lock.files["apps/api/src/main.ts"].outHash).toMatch(/^sha256:/);
  });
});

describe("recordModules", () => {
  it("appends modules in order and refreshes the lock; idempotent", () => {
    const root = tmp();
    write(root, "apps/api/src/main.ts", "x");
    initLockfile(root, {
      template: "base",
      packageManager: "npm",
      answers: { projectName: "app", packageManager: "npm" },
      version: "1.0.0",
    });

    recordModules(root, ["redis", "auth"], "1.0.0");
    let manifest = readManifest(root);
    expect(manifest?.modules.map((m) => m.name)).toEqual(["redis", "auth"]);
    expect(manifest?.modules[0]).toMatchObject({ name: "redis", order: 0, addedWith: "1.0.0" });

    recordModules(root, ["auth", "admin-dashboard"], "1.0.0");
    manifest = readManifest(root);
    expect(manifest?.modules.map((m) => m.name)).toEqual(["redis", "auth", "admin-dashboard"]);
  });

  it("is a no-op without a manifest", () => {
    const root = tmp();
    write(root, "apps/api/src/main.ts", "x");
    recordModules(root, ["auth"], "1.0.0");
    expect(existsSync(join(root, ".podokit/manifest.json"))).toBe(false);
  });

  it("merges module ownedGlobs into the manifest and keeps them owned across recompute", () => {
    const root = tmp();
    write(root, "apps/api/src/main.ts", "x");
    write(root, "apps/web/src/lib/blog/PostCard.svelte", "<p/>");
    initLockfile(root, { template: "base", packageManager: "npm", answers: {}, version: "1.0.0" });
    // by default a $lib file is managed
    expect(readFilesLock(root)?.files["apps/web/src/lib/blog/PostCard.svelte"].tier).toBe("managed");

    // a module declares a public path owned
    recordModules(root, ["blog"], "1.0.0", ["apps/web/src/lib/blog/**"]);
    expect(readManifest(root)?.ownedGlobs).toContain("apps/web/src/lib/blog/**");
    expect(readFilesLock(root)?.files["apps/web/src/lib/blog/PostCard.svelte"].tier).toBe("owned");

    // a later add/update (recompute without re-passing globs) keeps it owned
    recordModules(root, ["faq"], "1.0.0");
    expect(readFilesLock(root)?.files["apps/web/src/lib/blog/PostCard.svelte"].tier).toBe("owned");
  });
});

describe("mergeOwnedGlobs", () => {
  it("unions without duplicates, preserving order", () => {
    expect(mergeOwnedGlobs(["a", "b"], ["b", "c", "a", "d"])).toEqual(["a", "b", "c", "d"]);
  });
  it("returns the original when nothing new is added", () => {
    expect(mergeOwnedGlobs(["a", "b"], [])).toEqual(["a", "b"]);
  });
});
