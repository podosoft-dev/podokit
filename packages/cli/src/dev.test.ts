import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initLockfile, readManifest, writeManifest } from "./lockfile";
import {
  installedDevProfiles,
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
    template: "fullstack",
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
    expect(readDevConfig(root)).toEqual({
      schemaVersion: 1,
      hostname: "example-app.localhost",
      webSocketPaths: [],
    });
    writeFileSync(
      join(root, ".podokit", "dev.json"),
      JSON.stringify({ schemaVersion: 1, hostname: "app.localhost", publicUrl: "https://dev.example.com" }),
    );
    expect(readDevConfig(root)).toEqual({
      schemaVersion: 1,
      hostname: "app.localhost",
      publicUrl: "https://dev.example.com",
      webSocketPaths: [],
    });
    const publicRoute = renderRoute(resolveDevRuntime(root));
    expect(publicRoute).toContain(
      "Host(`app.localhost`) || Host(`dev.example.com`)",
    );

    writeFileSync(
      join(root, ".podokit", "dev.json"),
      JSON.stringify({ schemaVersion: 1, hostname: "app.localhost:5080" }),
    );
    expect(() => readDevConfig(root)).toThrow("without a scheme or port");

    writeFileSync(
      join(root, ".podokit", "dev.json"),
      JSON.stringify({
        schemaVersion: 1,
        hostname: "app.localhost",
        publicUrl: "https://user:password@dev.example.com",
      }),
    );
    expect(() => readDevConfig(root)).toThrow("HTTPS origin without a path");
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
    expect(compose).not.toContain(`${runtime.alias}-api`);
  });

  it("routes only configured exact WebSocket paths to the API", () => {
    const root = project();
    writeFileSync(
      join(root, ".podokit", "dev.json"),
      JSON.stringify({
        schemaVersion: 1,
        hostname: "example-app.localhost",
        publicUrl: "https://ws.example.com",
        webSocketPaths: ["/events/ws", "/notifications/socket"],
      }),
    );
    const runtime = resolveDevRuntime(root);
    const route = renderRoute(runtime);
    const compose = renderRuntimeCompose(runtime);

    expect(route).toContain(
      "(Host(`example-app.localhost`) || Host(`ws.example.com`)) && Path(`/events/ws`, `/notifications/socket`)",
    );
    expect(route).toContain("priority: 100");
    expect(route).toContain(`url: http://${runtime.alias}-api:5002`);
    expect(route).not.toContain("PathPrefix");
    expect(compose).toContain(`aliases: [${runtime.alias}-api]`);
  });

  it.each([
    ["a string", "must be an array"],
    [["/"], "only static absolute paths"],
    [["/events/*"], "only static absolute paths"],
    [["/events/ws?token=value"], "only static absolute paths"],
    [["/events/%2fadmin"], "only static absolute paths"],
    [["/events/../admin"], "only static absolute paths"],
    [["/events/ws", "/events/ws"], "duplicate path"],
  ])("rejects unsafe WebSocket path configuration %#", (webSocketPaths, message) => {
    const root = project();
    writeFileSync(
      join(root, ".podokit", "dev.json"),
      JSON.stringify({ schemaVersion: 1, hostname: "app.localhost", webSocketPaths }),
    );

    expect(() => readDevConfig(root)).toThrow(message);
  });

  it("activates profiles required by installed modules", () => {
    const root = project();
    const manifest = readManifest(root)!;
    manifest.modules = [
      { name: "redis", order: 0, addedWith: "0.15.0" },
      { name: "object-storage-s3", order: 1, addedWith: "0.15.0" },
      { name: "bullmq", order: 2, addedWith: "0.15.0" },
      { name: "rate-limit", order: 3, addedWith: "0.15.0" },
    ];
    writeManifest(root, manifest);
    expect(installedDevProfiles(root)).toEqual([
      "cache",
      "storage",
      "queue",
    ]);

    const devHome = temporaryDirectory("podokit-dev-home-");
    process.env.PODOKIT_DEV_HOME = devHome;
    const calls: string[][] = [];
    const runner: CommandRunner = (_command, args) => {
      calls.push(args);
      if (args[0] === "info") {
        return { status: 0, stdout: "27.0.0\n", stderr: "" };
      }
      if (args[0] === "network" && args[1] === "inspect") {
        return { status: 0, stdout: "present\n", stderr: "" };
      }
      if (args[0] === "inspect") {
        return { status: 0, stdout: "1 true 2\n", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    runDevCommand(root, "watch", ["--profile=cache"], runner);
    const watch = calls.find((args) => args.includes("watch"));
    expect(watch).toEqual(
      expect.arrayContaining([
        "--profile",
        "storage",
        "--profile",
        "queue",
        "--profile=cache",
        "watch",
      ]),
    );
    expect(
      watch?.filter(
        (value) => value === "cache" || value === "--profile=cache",
      ),
    ).toHaveLength(1);
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
          stdout: gatewayExists ? "1 true 2\n" : "",
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
    expect(
      calls.some(({ args }) =>
        args.includes("--entrypoints.web.forwardedheaders.insecure=true"),
      ),
    ).toBe(true);

    runDevCommand(root, "exec", ["api", "npm", "test"], runner);
    const execCall = calls.find(({ args }) => args.includes("exec"));
    expect(execCall?.args.slice(-4)).toEqual(["exec", "api", "npm", "test"]);

    runDevCommand(root, "down", ["--profile", "cache", "--volumes"], runner);
    const downCall = calls.find(({ args }) => args.includes("down"));
    expect(downCall?.args.slice(-6)).toEqual(["--profile", "*", "--profile", "cache", "down", "--volumes"]);
    expect(existsSync(join(devHome, "projects", `${runtime.routeId}.json`))).toBe(false);
    expect(calls.some(({ args }) => args[0] === "rm" && args.includes("podokit-dev-gateway"))).toBe(true);
  });

  it("replaces an older managed gateway before starting the stack", () => {
    const root = project();
    const devHome = temporaryDirectory("podokit-dev-home-");
    process.env.PODOKIT_DEV_HOME = devHome;
    const calls: string[][] = [];
    let gatewayExists = true;
    const runner: CommandRunner = (_command, args) => {
      calls.push(args);
      if (args[0] === "info") return { status: 0, stdout: "27.0.0\n", stderr: "" };
      if (args[0] === "network" && args[1] === "inspect") {
        return { status: 0, stdout: "present\n", stderr: "" };
      }
      if (args[0] === "inspect") {
        return {
          status: gatewayExists ? 0 : 1,
          stdout: gatewayExists ? "1 true 1\n" : "",
          stderr: "",
        };
      }
      if (args[0] === "rm") gatewayExists = false;
      if (args[0] === "run") gatewayExists = true;
      return { status: 0, stdout: "", stderr: "" };
    };

    runDevCommand(root, "up", ["-d"], runner);

    expect(calls.some((args) => args.slice(0, 3).join(" ") === "rm --force podokit-dev-gateway"))
      .toBe(true);
    const run = calls.find((args) => args[0] === "run");
    expect(run).toEqual(
      expect.arrayContaining([
        "io.podosoft.podokit.dev-gateway.version=2",
        "--entrypoints.web.forwardedheaders.insecure=true",
      ]),
    );
  });

  it("starts a detached stack through the shared gateway", () => {
    const root = project();
    const devHome = temporaryDirectory("podokit-dev-home-");
    process.env.PODOKIT_DEV_HOME = devHome;
    const calls: string[][] = [];
    let networkExists = false;
    let gatewayExists = false;
    const runner: CommandRunner = (_command, args) => {
      calls.push(args);
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
          stdout: gatewayExists ? "1 true 2\n" : "",
          stderr: "",
        };
      }
      if (args[0] === "run") gatewayExists = true;
      return { status: 0, stdout: "", stderr: "" };
    };

    runDevCommand(root, "up", ["-d", "--build"], runner);

    const upCall = calls.find((args) => args.includes("up"));
    expect(upCall?.slice(-3)).toEqual(["up", "-d", "--build"]);
    const originalRuntime = resolveDevRuntime(root);
    expect(readFileSync(originalRuntime.runtimeComposePath, "utf8")).toContain(
      "podokit-dev-gateway",
    );
    expect(calls.filter((args) => args[0] === "run")).toHaveLength(1);

    writeFileSync(
      join(root, ".podokit", "dev.json"),
      JSON.stringify({ schemaVersion: 1, hostname: "renamed.localhost" }),
    );
    runDevCommand(root, "up", ["-d"], runner);
    const renamedRuntime = resolveDevRuntime(root);
    expect(existsSync(join(devHome, "projects", `${originalRuntime.routeId}.json`))).toBe(false);
    expect(existsSync(join(devHome, "routes", `${originalRuntime.routeId}.yml`))).toBe(false);
    expect(existsSync(join(devHome, "projects", `${renamedRuntime.routeId}.json`))).toBe(true);
  });

  it("rejects a public host already registered by another project", () => {
    const first = project("first-app");
    const second = project("second-app");
    for (const [root, hostname] of [
      [first, "first-app.localhost"],
      [second, "second-app.localhost"],
    ]) {
      writeFileSync(
        join(root, ".podokit", "dev.json"),
        JSON.stringify({
          schemaVersion: 1,
          hostname,
          publicUrl: "https://shared.example.com",
          webSocketPaths: [],
        }),
      );
    }
    const devHome = temporaryDirectory("podokit-dev-home-");
    process.env.PODOKIT_DEV_HOME = devHome;
    const runner: CommandRunner = (_command, args) => {
      if (args[0] === "info") return { status: 0, stdout: "27.0.0\n", stderr: "" };
      if (args[0] === "network" && args[1] === "inspect") {
        return { status: 0, stdout: "present\n", stderr: "" };
      }
      if (args[0] === "inspect") return { status: 0, stdout: "1 true 2\n", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };

    runDevCommand(first, "up", ["-d"], runner);

    expect(() => runDevCommand(second, "up", ["-d"], runner)).toThrow(
      `Development host shared.example.com is already registered by ${first}`,
    );
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
