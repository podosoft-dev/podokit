import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initLockfile, readFilesLock } from "./lockfile";
import { eject } from "./eject";
import { NotAProjectError } from "./inspect";

const created: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "podokit-eject-"));
  created.push(dir);
  return dir;
}
function project(): string {
  const root = tmp();
  const main = join(root, "apps/api/src/main.ts");
  mkdirSync(join(main, ".."), { recursive: true });
  writeFileSync(main, "bootstrap()");
  initLockfile(root, { template: "base", packageManager: "npm", answers: {}, version: "0.4.0" });
  return root;
}
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("eject", () => {
  it("flips a managed file to owned in the lock", () => {
    const root = project();
    const result = eject(root, ["apps/api/src/main.ts"]);
    expect(result.ejected).toEqual(["apps/api/src/main.ts"]);
    expect(readFilesLock(root)?.files["apps/api/src/main.ts"].tier).toBe("owned");
  });
  it("reports unknown paths and does not fail", () => {
    const root = project();
    expect(eject(root, ["nope.ts"]).unknown).toEqual(["nope.ts"]);
  });
  it("is idempotent (already owned -> no change)", () => {
    const root = project();
    eject(root, ["apps/api/src/main.ts"]);
    expect(eject(root, ["apps/api/src/main.ts"]).ejected).toEqual([]);
  });
  it("throws outside a project", () => {
    expect(() => eject(tmp(), ["x"])).toThrow(NotAProjectError);
  });
});
