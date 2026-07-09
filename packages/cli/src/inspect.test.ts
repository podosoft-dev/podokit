import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initLockfile } from "./lockfile";
import { status, diff, doctor, leadingMajor, NotAProjectError } from "./inspect";

const created: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "podokit-inspect-"));
  created.push(dir);
  return dir;
}
function write(root: string, rel: string, content: string): void {
  const path = join(root, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}
function project(): string {
  const root = tmp();
  write(root, "apps/api/src/main.ts", "bootstrap()");
  write(root, "apps/api/src/app.module.ts", "// podokit:begin:imports\n// podokit:end:imports");
  write(root, "apps/web/src/routes/+page.svelte", "<h1/>");
  write(root, "apps/api/package.json", JSON.stringify({ dependencies: { "@nestjs/core": "^11.1.0", "better-auth": "^1.6.23" } }));
  write(root, "apps/web/package.json", JSON.stringify({ dependencies: { svelte: "^5.0.0" } }));
  initLockfile(root, { template: "fullstack-nest-svelte", packageManager: "npm", answers: {}, version: "0.4.0" });
  return root;
}
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("status", () => {
  it("reports version, tiers, and no drift on a fresh project", () => {
    const s = status(project());
    expect(s.podokitVersion).toBe("0.4.0");
    expect(s.tiers.owned).toBeGreaterThanOrEqual(1);
    expect(s.tiers.assembled).toBe(1);
    expect(s.drifted).toEqual([]);
  });
  it("throws outside a project", () => {
    expect(() => status(tmp())).toThrow(NotAProjectError);
  });
});

describe("diff", () => {
  it("reports edited managed files but ignores owned edits", () => {
    const root = project();
    write(root, "apps/api/src/main.ts", "bootstrap() // edited"); // managed -> drift
    write(root, "apps/web/src/routes/+page.svelte", "<h2/>"); // owned -> ignored
    const { drifted } = diff(root);
    expect(drifted).toContain("apps/api/src/main.ts");
    expect(drifted).not.toContain("apps/web/src/routes/+page.svelte");
  });
});

describe("doctor", () => {
  it("passes supported framework versions", () => {
    const findings = doctor(project());
    expect(findings.find((f) => f.package === "@nestjs/core")?.ok).toBe(true);
    expect(findings.find((f) => f.package === "svelte")?.ok).toBe(true);
  });
  it("warns on an unsupported major", () => {
    const root = project();
    write(root, "apps/api/package.json", JSON.stringify({ dependencies: { "@nestjs/core": "^13.0.0" } }));
    expect(doctor(root).find((f) => f.package === "@nestjs/core")?.ok).toBe(false);
  });
});

describe("leadingMajor", () => {
  it("parses the leading major from ranges", () => {
    expect(leadingMajor("^11.1.0")).toBe(11);
    expect(leadingMajor(">=1.6.23 <1.7")).toBe(1);
    expect(leadingMajor("latest")).toBeNull();
  });
});
