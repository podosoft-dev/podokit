import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initLockfile, readManifest, writeManifest } from "./lockfile";
import {
  devTemplateVars,
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
      apiPaths: [],
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
      apiPaths: [],
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

    // Traefik v3 matchers take a single value, so each path is its own matcher.
    expect(route).toContain(
      "(Host(`example-app.localhost`) || Host(`ws.example.com`)) && (Path(`/events/ws`) || Path(`/notifications/socket`))",
    );
    expect(route).toContain("priority: 100");
    expect(route).toContain(`url: http://${runtime.alias}-api:5002`);
    expect(route).not.toContain("PathPrefix");
    expect(compose).toContain(`aliases: [${runtime.alias}-api]`);
  });

  it("routes configured API paths to the API without the /api prefix", () => {
    const root = project();
    writeFileSync(
      join(root, ".podokit", "dev.json"),
      JSON.stringify({
        schemaVersion: 1,
        hostname: "example-app.localhost",
        webSocketPaths: ["/events/ws"],
        apiPaths: ["/api/files/uploads/", "/api/imports"],
      }),
    );
    const runtime = resolveDevRuntime(root);
    const route = renderRoute(runtime);
    const compose = renderRuntimeCompose(runtime);

    expect(runtime.config.apiPaths).toEqual(["/api/files/uploads/", "/api/imports"]);
    expect(route).toContain(
      `    ${runtime.routeId}-api-paths:\n      entryPoints: [web]\n      rule: Host(\`example-app.localhost\`) && (Path(\`/api/files/uploads\`) || PathPrefix(\`/api/files/uploads/\`) || Path(\`/api/imports\`) || PathPrefix(\`/api/imports/\`))\n      priority: 100\n      middlewares: [${runtime.routeId}-api-prefix]\n      service: ${runtime.routeId}-api\n`,
    );
    expect(route).toContain(
      `    ${runtime.routeId}-api-prefix:\n      stripPrefix:\n        prefixes: ["/api"]\n`,
    );
    expect(route).toContain("Path(`/events/ws`)");
    expect(route.match(new RegExp(`${runtime.routeId}-api:\n`, "g"))).toHaveLength(1);
    expect(route).toContain(`url: http://${runtime.alias}-api:5002`);
    // Everything else still reaches the web service, which proxies /api itself.
    expect(route).toContain(`url: http://${runtime.alias}:5001`);
    expect(compose).toContain(`aliases: [${runtime.alias}-api]`);
  });

  it("joins the API network for API paths without WebSocket paths", () => {
    const root = project();
    writeFileSync(
      join(root, ".podokit", "dev.json"),
      JSON.stringify({ schemaVersion: 1, hostname: "app.localhost", apiPaths: ["/api/files/uploads/"] }),
    );
    const runtime = resolveDevRuntime(root);

    expect(renderRuntimeCompose(runtime)).toContain(`aliases: [${runtime.alias}-api]`);
    expect(renderRoute(runtime)).not.toContain("-websocket:");
  });

  it.each([
    ["a string", "must be an array"],
    [["/api/"], "static path prefixes under /api/"],
    [["/files/uploads/"], "static path prefixes under /api/"],
    [["/api/files/*"], "static path prefixes under /api/"],
    [["/api/files/uploads?x=1"], "static path prefixes under /api/"],
    [["/api/files/%2e%2e/admin"], "static path prefixes under /api/"],
    [["/api/files//uploads/"], "static path prefixes under /api/"],
    [["/api/files/../admin/"], "static path prefixes under /api/"],
    [["/api/auth/"], "authentication routes always go through the web proxy"],
    [["/api/auth/sign-in"], "authentication routes always go through the web proxy"],
    [["/api/files/", "/api/files/"], "duplicate path"],
    [["/api/files/", "/api/files/uploads/"], "overlapping paths"],
    [["/api/files", "/api/files/"], "overlapping paths"],
  ])("rejects unsafe API path configuration %#", (apiPaths, message) => {
    const root = project();
    writeFileSync(
      join(root, ".podokit", "dev.json"),
      JSON.stringify({ schemaVersion: 1, hostname: "app.localhost", apiPaths }),
    );

    expect(() => readDevConfig(root)).toThrow(message);
  });

  it("rejects an API path that covers a WebSocket path", () => {
    const root = project();
    writeFileSync(
      join(root, ".podokit", "dev.json"),
      JSON.stringify({
        schemaVersion: 1,
        hostname: "app.localhost",
        webSocketPaths: ["/api/live/ws"],
        apiPaths: ["/api/live/"],
      }),
    );

    expect(() => readDevConfig(root)).toThrow('covers WebSocket path "/api/live/ws"');
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

  it("rebuilds images on up so a recreated container runs the current source", () => {
    const root = project();
    process.env.PODOKIT_DEV_HOME = temporaryDirectory("podokit-dev-home-");
    const calls: string[][] = [];
    const runner: CommandRunner = (_command, args) => {
      calls.push(args);
      if (args[0] === "info") return { status: 0, stdout: "27.0.0\n", stderr: "" };
      if (args[0] === "network" && args[1] === "inspect") return { status: 0, stdout: "present\n", stderr: "" };
      if (args[0] === "inspect") return { status: 0, stdout: "1 true 2\n", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };
    const upArgs = (): string[] | undefined => calls.filter((args) => args.includes("up")).at(-1);

    // Watch syncs edits into running containers only. A plain `up` that
    // recreates one (a changed limit or env file) used the image from the
    // last build and silently dropped every synced edit.
    runDevCommand(root, "up", ["-d"], runner);
    expect(upArgs()?.slice(-3)).toEqual(["up", "--build", "-d"]);

    runDevCommand(root, "up", ["-d", "--no-build"], runner);
    expect(upArgs()?.slice(-3)).toEqual(["up", "-d", "--no-build"]);
    expect(upArgs()).not.toContain("--build");

    runDevCommand(root, "up", ["--build", "web"], runner);
    expect(upArgs()?.filter((value) => value === "--build")).toHaveLength(1);
  });

  it("creates the container environment from the committed example with local secrets", () => {
    const root = project();
    process.env.PODOKIT_DEV_HOME = temporaryDirectory("podokit-dev-home-");
    writeFileSync(join(root, "compose.dev.yaml"), "services:\n  api:\n    env_file: .env.docker\n");
    writeFileSync(
      join(root, ".env.docker.example"),
      "# Container environment\nPORT=5002\nBETTER_AUTH_SECRET=\nJOB_SIGNING_SECRET=\nAPI_KEYS=dev-key-please-change\n",
    );
    const calls: string[][] = [];
    const runner: CommandRunner = (_command, args) => {
      calls.push(args);
      if (args[0] === "inspect") return { status: 0, stdout: "1 true 2\n", stderr: "" };
      return { status: 0, stdout: "27.0.0\n", stderr: "" };
    };

    // A fresh clone has no .env.docker because Git ignores it.
    runDevCommand(root, "env", [], runner);
    expect(calls).toEqual([]);
    const env = readFileSync(join(root, ".env.docker"), "utf8");
    expect(env).toContain("PORT=5002\n");
    expect(env).toContain("API_KEYS=dev-key-please-change\n");
    const authSecret = env.match(/^BETTER_AUTH_SECRET=(.+)$/m)?.[1] ?? "";
    const jobSecret = env.match(/^JOB_SIGNING_SECRET=(.+)$/m)?.[1] ?? "";
    expect(authSecret.length).toBeGreaterThanOrEqual(32);
    expect(jobSecret.length).toBeGreaterThanOrEqual(32);
    expect(authSecret).not.toBe(jobSecret);

    // An existing file holds the developer's own values and is never replaced.
    writeFileSync(join(root, ".env.docker"), "BETTER_AUTH_SECRET=kept-local-value-with-32-characters\n");
    runDevCommand(root, "down", [], runner);
    expect(readFileSync(join(root, ".env.docker"), "utf8")).toBe(
      "BETTER_AUTH_SECRET=kept-local-value-with-32-characters\n",
    );

    rmSync(join(root, ".env.docker"));
    runDevCommand(root, "up", ["-d"], runner);
    expect(existsSync(join(root, ".env.docker"))).toBe(true);
  });

  it("explains how to restore a missing container environment", () => {
    const root = project();
    writeFileSync(join(root, "compose.dev.yaml"), "services:\n  api:\n    env_file: .env.docker\n");
    const runner: CommandRunner = () => ({ status: 0, stdout: "", stderr: "" });

    expect(() => runDevCommand(root, "up", ["-d"], runner)).toThrow("podo update --apply");
  });

  it("stops this project's Compose Watch before taking the stack down", () => {
    const root = project();
    const other = project("other-app");
    process.env.PODOKIT_DEV_HOME = temporaryDirectory("podokit-dev-home-");
    const own = resolveDevRuntime(root).runtimeComposePath;
    const foreign = resolveDevRuntime(other).runtimeComposePath;
    const alive = new Set([4101, 4102, 4201, 4301]);
    const calls: string[][] = [];
    const runner: CommandRunner = (command, args) => {
      calls.push([command, ...args]);
      if (command === "ps") {
        return {
          status: 0,
          stdout: [
            `4101 docker compose -f compose.dev.yaml -f ${own} --profile cache watch`,
            `4102 /usr/libexec/docker/cli-plugins/docker-compose compose -f compose.dev.yaml -f ${own} --profile cache watch`,
            `4201 /usr/libexec/docker/cli-plugins/docker-compose compose -f compose.dev.yaml -f ${foreign} watch`,
            `4301 docker compose -f compose.dev.yaml -f ${own} logs -f`,
          ].join("\n"),
          stderr: "",
        };
      }
      if (command === "kill") {
        const pids = args.slice(1).map(Number);
        if (args[0] === "-0") return { status: pids.some((pid) => alive.has(pid)) ? 0 : 1, stdout: "", stderr: "" };
        for (const pid of pids) alive.delete(pid);
        return { status: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "info") return { status: 0, stdout: "27.0.0\n", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };

    // A watch left running keeps Compose's project lock, so the next
    // `podo dev watch` failed with "cannot take exclusive lock".
    runDevCommand(root, "down", [], runner);

    const signals = calls.filter(([command, flag]) => command === "kill" && flag === "-TERM");
    expect(signals).toEqual([["kill", "-TERM", "4101", "4102"]]);
    expect(alive).toEqual(new Set([4201, 4301]));
    const stopIndex = calls.findIndex(([command]) => command === "kill");
    const downIndex = calls.findIndex((call) => call.includes("down"));
    expect(stopIndex).toBeGreaterThan(-1);
    expect(stopIndex).toBeLessThan(downIndex);
  });

  it("ends a watch stopped by podo dev down without an error", () => {
    const root = project();
    const devHome = temporaryDirectory("podokit-dev-home-");
    process.env.PODOKIT_DEV_HOME = devHome;
    const runner: CommandRunner = (_command, args) => {
      if (args[0] === "info") return { status: 0, stdout: "27.0.0\n", stderr: "" };
      if (args[0] === "network" && args[1] === "inspect") return { status: 0, stdout: "present\n", stderr: "" };
      if (args[0] === "inspect") return { status: 0, stdout: "1 true 2\n", stderr: "" };
      if (args.includes("watch")) return { status: 130, stdout: "", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };

    expect(() => runDevCommand(root, "watch", [], runner)).not.toThrow();
    expect(existsSync(join(devHome, "projects", `${resolveDevRuntime(root).routeId}.json`))).toBe(false);
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

describe("development origins from .podokit/dev.json", () => {
  const originalAuthUrl = process.env.PODOKIT_DEV_AUTH_URL;
  afterEach(() => {
    if (originalAuthUrl === undefined) delete process.env.PODOKIT_DEV_AUTH_URL;
    else process.env.PODOKIT_DEV_AUTH_URL = originalAuthUrl;
  });

  function renamed(): string {
    const root = project();
    writeFileSync(
      join(root, ".podokit", "dev.json"),
      JSON.stringify({ schemaVersion: 1, hostname: "shop.localhost", publicUrl: "https://shop-dev.example.com" }),
    );
    return root;
  }

  it("sets CORS_ORIGIN and BETTER_AUTH_URL for web and api in the overlay", () => {
    delete process.env.PODOKIT_DEV_AUTH_URL;
    const compose = renderRuntimeCompose(resolveDevRuntime(renamed()));
    const environment =
      '    environment:\n' +
      '      CORS_ORIGIN: "http://shop.localhost,https://shop-dev.example.com,http://localhost"\n' +
      '      BETTER_AUTH_URL: "http://shop.localhost"\n';
    expect(compose).toContain(`  web:\n${environment}`);
    expect(compose).toContain(`  api:\n${environment}`);
  });

  it("uses the public origin for BETTER_AUTH_URL when PODOKIT_DEV_AUTH_URL names it", () => {
    process.env.PODOKIT_DEV_AUTH_URL = "https://shop-dev.example.com";
    expect(renderRuntimeCompose(resolveDevRuntime(renamed()))).toContain(
      'BETTER_AUTH_URL: "https://shop-dev.example.com"',
    );
    process.env.PODOKIT_DEV_AUTH_URL = "https://elsewhere.example.com";
    expect(() => resolveDevRuntime(renamed())).toThrow(
      "PODOKIT_DEV_AUTH_URL must be http://shop.localhost or https://shop-dev.example.com",
    );
  });

  it("renders the container environment example from the declared hostname", () => {
    const root = renamed();
    const vars = devTemplateVars("example-app", root);
    expect(vars).toEqual({
      devHostname: "shop.localhost",
      devCorsOrigin: "http://shop.localhost,https://shop-dev.example.com,http://localhost",
      devAuthUrl: "http://shop.localhost",
    });
    expect(devTemplateVars("example-app")).toEqual({
      devHostname: "example-app.localhost",
      devCorsOrigin: "http://example-app.localhost,http://localhost",
      devAuthUrl: "http://example-app.localhost",
    });
    writeFileSync(join(root, ".podokit", "dev.json"), "{ not json");
    expect(devTemplateVars("example-app", root).devHostname).toBe("example-app.localhost");
  });
});
