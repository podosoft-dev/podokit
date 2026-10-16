import { describe, expect, it } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const BUILD = join(__dirname, "../scripts/build.mjs");

/** Builds an API layout made of `files` with the app's build script. */
async function build(files: Record<string, string>): Promise<{ root: string; code: number; stderr: string }> {
  const root = mkdtempSync(join(tmpdir(), "api-build-"));
  mkdirSync(join(root, "scripts"));
  cpSync(BUILD, join(root, "scripts/build.mjs"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  const child = Bun.spawn([process.execPath, "scripts/build.mjs"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  return { root, code, stderr };
}

async function run(root: string, entry: string, env: Record<string, string>): Promise<string> {
  const child = Bun.spawn([process.execPath, entry], { cwd: root, env: { ...process.env, ...env }, stdout: "pipe" });
  const [stdout] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return stdout.trim();
}

describe("API build", () => {
  it("leaves NODE_ENV to the environment the bundle runs in", async () => {
    const { root, code, stderr } = await build({ "src/main.ts": "console.log(process.env.NODE_ENV);\n" });
    try {
      expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
      expect(await run(root, "dist/main.js", { NODE_ENV: "production" })).toBe("production");
      expect(await run(root, "dist/main.js", { NODE_ENV: "test" })).toBe("test");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
