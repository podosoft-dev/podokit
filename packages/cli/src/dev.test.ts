import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initLockfile } from "./lockfile";
import {
  readDevConfig,
  renderRoute,
  renderRuntimeCompose,
  resolveDevRuntime,
  runDevCommand,
  type CommandRunner,
} from "./dev";

const created: string[] = [];
const originalDevHome = process.env.PODOKIT_DEV_HOME;

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  created.push(directory);
  return directory;
}

function project(name = "example-app"): string {
  const root = temporaryDirectory("podokit-dev-project-");
  mkdirSync(join(root, "apps", "web"), { recursive: true });
  writeFileSync(join(root, "apps", "web", "placeholder.txt"), "web\n");
  initLockfile(root, {
    template: "fullstack-nest-svelte",
    packageManager: "npm",
    answers: { projectName: name },
    version: "0.11.2",
  });
  return root;
}

afterEach(() => {
  if (originalDevHome === undefined) delete process.env.PODOKIT_DEV_HOME;
  else process.env.PODOKIT_DEV_HOME = originalDevHome;
  for (const directory of created.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("PodoKit development gateway", () => {
  it("uses a project-name localhost default and validates an HTTPS public origin", () => {
    const root = project();
    expect(readDevConfig(root)).toEqual({ schemaVersion: 1, hostname: "example-app.localhost" });

    writeFileSync(
      join(root, ".podokit", "dev.json"),
      JSON.stringify({ schemaVersion: 1, hostname: "app.localhost", publicUrl: "https://dev.example.com" }),
    );
    expect(readDevConfig(root)).toEqual({
      schemaVersion: 1,
      hostname: "app.localhost",
      publicUrl: "https://dev.example.com",
    });

    writeFileSync(
      join(root, ".podokit", "dev.json"),
      JSON.stringify({ schemaVersion: 1, hostname: "app.localhost:5080" }),
    );
    expect(() => readDevConfig(root)).toThrow("without a scheme or port");
  });

  it("renders a socket-free shared route and disables the legacy proxy", () => {
    const runtime = resolveDevRuntime(project());
    const route = renderRoute(runtime);
    const compose = renderRuntimeCompose(runtime);

    expect(route).toContain("Host(`example-app.localhost`)");
    expect(route).toContain(`http://${runtime.alias}:5001`);
    expect(route).not.toContain("docker.sock");
    expect(compose).toContain("profiles: [podokit-legacy-proxy]");
    expect(compose).toContain("external: true");
  });

  it("starts one gateway, delegates compose commands, and removes the final route", () => {
    const root = project();
    const devHome = temporaryDirectory("podokit-dev-home-");
    process.env.PODOKIT_DEV_HOME = devHome;
    const calls: Array<{ args: string[]; capture: boolean }> = [];
    let networkExists = false;
    let gatewayExists = false;
    const runner: CommandRunner = (_command, args, options) => {
      calls.push({ args, capture: options.capture });
      if (args[0] === "info") return { status: 0, stdout: "27.0.0\n", stderr: "" };
      if (args[0] === "network" && args[1] === "inspect") {
        return { status: networkExists ? 0 : 1, stdout: "", stderr: "" };
      }
      if (args[0] === "network" && args[1] === "create") {
        networkExists = true;
        return { status: 0, stdout: "created\n", stderr: "" };
      }
      if (args[0] === "inspect") {
        return {
          status: gatewayExists ? 0 : 1,
          stdout: gatewayExists ? "1 true\n" : "",
          stderr: "",
        };
      }
      if (args[0] === "run") gatewayExists = true;
      if (args[0] === "rm") gatewayExists = false;
      if (args[0] === "network" && args[1] === "rm") networkExists = false;
      return { status: 0, stdout: "", stderr: "" };
    };

    runDevCommand(root, "watch", ["--profile", "cache"], runner);
    const runtime = resolveDevRuntime(root);
    expect(existsSync(runtime.runtimeComposePath)).toBe(true);
    expect(readFileSync(runtime.runtimeComposePath, "utf8")).toContain(runtime.alias);
    expect(calls.some(({ args }) => args.includes("watch") && args.includes("cache"))).toBe(true);
    expect(calls.filter(({ args }) => args[0] === "run")).toHaveLength(1);

    runDevCommand(root, "exec", ["api", "npm", "test"], runner);
    const execCall = calls.find(({ args }) => args.includes("exec"));
    expect(execCall?.args.slice(-4)).toEqual(["exec", "api", "npm", "test"]);

    runDevCommand(root, "down", ["--profile", "cache", "--volumes"], runner);
    const downCall = calls.find(({ args }) => args.includes("down"));
    expect(downCall?.args.slice(-6)).toEqual(["--profile", "*", "--profile", "cache", "down", "--volumes"]);
    expect(existsSync(join(devHome, "projects", `${runtime.routeId}.json`))).toBe(false);
    expect(calls.some(({ args }) => args[0] === "rm" && args.includes("podokit-dev-gateway"))).toBe(true);
  });

  it("activates every compose profile when stopping a project", () => {
    const root = project();
    const devHome = temporaryDirectory("podokit-dev-home-");
    process.env.PODOKIT_DEV_HOME = devHome;
    const calls: string[][] = [];
    const runner: CommandRunner = (_command, args) => {
      calls.push(args);
      if (args[0] === "info") return { status: 0, stdout: "27.0.0\n", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };

    runDevCommand(root, "down", [], runner);

    const downCall = calls.find((args) => args.includes("down"));
    expect(downCall?.slice(-3)).toEqual(["--profile", "*", "down"]);
  });

  it("preserves the route when compose down fails", () => {
    const root = project();
    const devHome = temporaryDirectory("podokit-dev-home-");
    process.env.PODOKIT_DEV_HOME = devHome;
    const runner: CommandRunner = (_command, args) => {
      if (args[0] === "info") return { status: 0, stdout: "27.0.0\n", stderr: "" };
      if (args[0] === "inspect") return { status: 1, stdout: "", stderr: "not found" };
      if (args.includes("down")) return { status: 1, stdout: "", stderr: "compose failed" };
      return { status: 0, stdout: "", stderr: "" };
    };

    runDevCommand(root, "watch", [], runner);
    const runtime = resolveDevRuntime(root);
    const registration = join(devHome, "projects", `${runtime.routeId}.json`);
    expect(existsSync(registration)).toBe(true);

    expect(() => runDevCommand(root, "down", [], runner)).toThrow("exited with status 1");
    expect(existsSync(registration)).toBe(true);
  });
});
