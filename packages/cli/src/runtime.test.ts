import { afterEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { addModule } from "./add";
import { create } from "./create";
import { eject } from "./eject";
import { readManifest } from "./lockfile";
import { applyRuntimeSet, planRuntimeSet, type RuntimeCommandRunner } from "./runtime";

const REPO_TEMPLATES = resolve(process.cwd(), "..", "..", "templates");
const created: string[] = [];

function project(runtime: "node" | "bun" = "node", ai = true): string {
  const root = mkdtempSync(join(tmpdir(), "podokit-runtime-"));
  created.push(root);
  create({
    name: "runtime-app",
    runtime,
    ai,
    templatesDir: REPO_TEMPLATES,
    targetDir: root,
  });
  return root;
}

afterEach(() => {
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
});

function successfulRunner(commands: string[]): RuntimeCommandRunner {
  return (command, args, cwd) => {
    commands.push(`${command} ${args.join(" ")}`.trim());
    if (args[0] === "--version") {
      return command === "bun" ? "1.4.0\n" : command === "node" ? "v22.22.1\n" : "11.0.0\n";
    }
    if (command === "bun" && args[0] === "install") {
      expect(existsSync(join(cwd, "package-lock.json"))).toBe(false);
      expect(existsSync(join(cwd, "bun.lock"))).toBe(false);
      mkdirSync(join(cwd, "node_modules"), { recursive: true });
      writeFileSync(join(cwd, "bun.lock"), "lockfileVersion = 1\n");
    }
    if (command === "npm" && args[0] === "install") {
      expect(existsSync(join(cwd, "bun.lock"))).toBe(false);
      expect(existsSync(join(cwd, "package-lock.json"))).toBe(false);
      mkdirSync(join(cwd, "node_modules"), { recursive: true });
      writeFileSync(join(cwd, "package-lock.json"), '{"lockfileVersion":3}\n');
    }
    return "";
  };
}

describe("runtime conversion", () => {
  it("previews managed Node-to-Bun changes without writing", () => {
    const root = project();
    const before = readFileSync(join(root, "package.json"), "utf8");
    const plan = planRuntimeSet(root, REPO_TEMPLATES, "bun");

    expect(plan.target).toEqual({
      runtime: "bun",
      runtimeVersion: "1.4.0",
      packageManager: "bun",
    });
    expect(plan.changes).toContainEqual(expect.objectContaining({ path: "bunfig.toml", action: "add" }));
    expect(readFileSync(join(root, "package.json"), "utf8")).toBe(before);
    expect(readManifest(root)?.toolchain.runtime).toBe("node");
  });

  it("converts Node to Bun and back to Node/npm", () => {
    const root = project();
    const commands: string[] = [];
    writeFileSync(join(root, "package-lock.json"), '{"lockfileVersion":3}\n');
    addModule({
      projectRoot: root,
      module: "bullmq",
      modulesDir: join(REPO_TEMPLATES, "modules"),
    });

    applyRuntimeSet(root, REPO_TEMPLATES, "bun", {
      runner: successfulRunner(commands),
    });
    expect(readManifest(root)?.toolchain.runtime).toBe("bun");
    expect(existsSync(join(root, "bun.lock"))).toBe(true);
    expect(existsSync(join(root, "package-lock.json"))).toBe(false);
    expect(readFileSync(join(root, "package.json"), "utf8")).toContain('"bun@1.4.0"');
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain(
      "bun runtime, bun workspaces",
    );
    expect(readFileSync(join(root, ".mcp.json"), "utf8")).toContain('"command": "bunx"');
    expect(readFileSync(join(root, "infra/k3s/worker-deployment.yaml"), "utf8")).toContain(
      'command: ["bun", "dist/main-worker"]',
    );
    expect(readFileSync(join(root, ".devcontainer/devcontainer.json"), "utf8")).toContain(
      '"remoteUser": "bun"',
    );
    expect(commands).toContain("bun audit --audit-level=high");

    applyRuntimeSet(root, REPO_TEMPLATES, "node", {
      runner: successfulRunner(commands),
    });
    expect(readManifest(root)?.toolchain).toEqual({
      runtime: "node",
      runtimeVersion: "22.22.1",
      packageManager: "npm",
    });
    expect(existsSync(join(root, "package-lock.json"))).toBe(true);
    expect(existsSync(join(root, "bun.lock"))).toBe(false);
    expect(existsSync(join(root, "bunfig.toml"))).toBe(false);
    expect(readFileSync(join(root, "package.json"), "utf8")).toContain('"node": ">=22.22.1"');
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain(
      "node runtime, npm workspaces",
    );
    expect(readFileSync(join(root, "infra/k3s/worker-deployment.yaml"), "utf8")).toContain(
      'command: ["node", "dist/main-worker"]',
    );
    expect(readFileSync(join(root, ".devcontainer/devcontainer.json"), "utf8")).toContain(
      '"remoteUser": "node"',
    );
  });

  it("does not restore AI guidance that creation explicitly skipped", () => {
    const root = project("node", false);
    expect(existsSync(join(root, "AGENTS.md"))).toBe(false);

    applyRuntimeSet(root, REPO_TEMPLATES, "bun", {
      runner: successfulRunner([]),
    });

    expect(existsSync(join(root, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(root, ".claude"))).toBe(false);
  });

  it("refuses to rewrite an explicitly ejected runtime file", () => {
    const root = project();
    expect(eject(root, ["package.json"]).ejected).toEqual(["package.json"]);

    expect(() => planRuntimeSet(root, REPO_TEMPLATES, "bun")).toThrow(
      /ejected file.*package\.json/is,
    );
  });

  it("restores files, lockfiles, and node_modules when validation fails", () => {
    const root = project();
    writeFileSync(join(root, "package-lock.json"), "original-lock\n");
    mkdirSync(join(root, "node_modules"), { recursive: true });
    writeFileSync(join(root, "node_modules/sentinel"), "original\n");
    const beforePackage = readFileSync(join(root, "package.json"), "utf8");
    const runner: RuntimeCommandRunner = (command, args, cwd) => {
      if (command === "bun" && args[0] === "--version") return "1.4.0\n";
      if (command === "bun" && args[0] === "install") {
        mkdirSync(join(cwd, "node_modules"), { recursive: true });
        writeFileSync(join(cwd, "bun.lock"), "new-lock\n");
        return "";
      }
      if (command === "bun" && args[0] === "audit") throw new Error("audit failed");
      return "";
    };

    expect(() => applyRuntimeSet(root, REPO_TEMPLATES, "bun", { runner })).toThrow(
      /audit failed/,
    );
    expect(readManifest(root)?.toolchain.runtime).toBe("node");
    expect(readFileSync(join(root, "package.json"), "utf8")).toBe(beforePackage);
    expect(readFileSync(join(root, "package-lock.json"), "utf8")).toBe("original-lock\n");
    expect(existsSync(join(root, "bun.lock"))).toBe(false);
    expect(readFileSync(join(root, "node_modules/sentinel"), "utf8")).toBe("original\n");
  });

  it("restores a read-only source lockfile by replacing it", () => {
    const root = project();
    const sourceLock = join(root, "package-lock.json");
    writeFileSync(sourceLock, "read-only-lock\n", { mode: 0o444 });
    const runner: RuntimeCommandRunner = (command, args, cwd) => {
      if (command === "bun" && args[0] === "--version") return "1.4.0\n";
      if (command === "bun" && args[0] === "install") {
        writeFileSync(join(cwd, "bun.lock"), "new-lock\n");
        return "";
      }
      throw new Error("validation failed");
    };

    expect(() => applyRuntimeSet(root, REPO_TEMPLATES, "bun", { runner })).toThrow(
      /validation failed/,
    );
    expect(readFileSync(sourceLock, "utf8")).toBe("read-only-lock\n");
  });

  it("aborts before installation when managed-file edits cannot merge", () => {
    const root = project();
    const packagePath = join(root, "package.json");
    writeFileSync(
      packagePath,
      readFileSync(packagePath, "utf8").replace('"node": ">=22.22.1"', '"node": ">=99"'),
    );
    const commands: string[] = [];

    expect(() =>
      applyRuntimeSet(root, REPO_TEMPLATES, "bun", {
        runner: successfulRunner(commands),
      }),
    ).toThrow(/conflict/i);
    expect(commands).toEqual(["bun --version"]);
    expect(readManifest(root)?.toolchain.runtime).toBe("node");
    expect(readFileSync(packagePath, "utf8")).toContain('"node": ">=99"');
  });
});
