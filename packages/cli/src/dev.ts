import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { API_PATH_PREFIX, apiPathBase, parseApiPaths } from "./api-paths";
import { readManifest } from "./lockfile";
import { parseExactWebSocketPaths } from "./websocket-paths";

const GATEWAY_CONTAINER = "podokit-dev-gateway";
const GATEWAY_IMAGE = "traefik:v3.5";
const GATEWAY_LABEL = "io.podosoft.podokit.dev-gateway";
const GATEWAY_VERSION = "2";
const GATEWAY_VERSION_LABEL = "io.podosoft.podokit.dev-gateway.version";
const GATEWAY_NETWORK = "podokit-dev-gateway";
const RUNTIME_COMPOSE = ".podokit/runtime/dev.compose.yaml";
const DEV_CONFIG = ".podokit/dev.json";
const CONTAINER_ENV = ".env.docker";
const CONTAINER_ENV_EXAMPLE = ".env.docker.example";
const GENERATED_SECRET = /^([A-Z][A-Z0-9_]*_SECRET)=[ \t]*(\r?)$/gm;
const DEV_PROFILE_BY_MODULE = new Map([
  ["redis", "cache"],
  ["object-storage-s3", "storage"],
  ["bullmq", "queue"],
]);

export interface DevConfig {
  schemaVersion: 1;
  hostname: string;
  publicUrl?: string;
  webSocketPaths: string[];
  /** Path prefixes under /api/ that skip the web proxy and reach the API directly. */
  apiPaths: string[];
}

export interface DevRuntime {
  alias: string;
  config: DevConfig;
  projectRoot: string;
  routeId: string;
  runtimeComposePath: string;
}

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options: { capture: boolean },
) => CommandResult;

function defaultRunner(
  command: string,
  args: string[],
  options: { capture: boolean },
): CommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: options.capture ? (result.stdout ?? "") : "",
    stderr: options.capture ? (result.stderr ?? "") : "",
  };
}

function parseJson<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    throw new Error(`Cannot read ${path}: ${(error as Error).message}`);
  }
}

function validateHostname(hostname: string): void {
  if (
    hostname.length > 253 ||
    !hostname.endsWith(".localhost") ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.localhost$/.test(hostname)
  ) {
    throw new Error(
      `Invalid development hostname "${hostname}". Use a lowercase *.localhost hostname without a scheme or port.`,
    );
  }
}

function validatePublicUrl(publicUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(publicUrl);
  } catch {
    throw new Error(`Invalid publicUrl "${publicUrl}". Use an absolute HTTPS URL.`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`Invalid publicUrl "${publicUrl}". Use an HTTPS origin without a path.`);
  }
}

export function readDevConfig(projectRoot: string): DevConfig {
  const path = join(projectRoot, DEV_CONFIG);
  const manifest = readManifest(projectRoot);
  if (!manifest) throw new Error("Not a PodoKit project: .podokit/manifest.json is missing.");

  const fallbackName = manifest.answers.projectName;
  if (!fallbackName) throw new Error("PodoKit manifest is missing answers.projectName.");
  const config = existsSync(path)
    ? parseJson<DevConfig>(path)
    : {
        schemaVersion: 1 as const,
        hostname: `${fallbackName}.localhost`,
        webSocketPaths: [],
        apiPaths: [],
      };

  if (config.schemaVersion !== 1) {
    throw new Error(`Unsupported ${DEV_CONFIG} schemaVersion: ${String(config.schemaVersion)}`);
  }
  validateHostname(config.hostname);
  if (config.publicUrl) validatePublicUrl(config.publicUrl);
  const webSocketPaths = parseExactWebSocketPaths(
    config.webSocketPaths ?? [],
    `${DEV_CONFIG}.webSocketPaths`,
  );
  return {
    ...config,
    webSocketPaths,
    apiPaths: parseApiPaths(config.apiPaths ?? [], `${DEV_CONFIG}.apiPaths`, webSocketPaths),
  };
}

function stableId(projectRoot: string): string {
  return createHash("sha256").update(projectRoot).digest("hex").slice(0, 10);
}

function slug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.slice(0, 36) || "app";
}

export function resolveDevRuntime(projectRoot: string): DevRuntime {
  const root = resolve(projectRoot);
  const config = readDevConfig(root);
  const id = stableId(root);
  const projectSlug = slug(config.hostname.replace(/\.localhost$/, ""));
  return {
    alias: `podokit-${projectSlug}-${id}`,
    config,
    projectRoot: root,
    routeId: `route-${projectSlug}-${id}`,
    runtimeComposePath: join(root, RUNTIME_COMPOSE),
  };
}

export function installedDevProfiles(projectRoot: string): string[] {
  const manifest = readManifest(projectRoot);
  if (!manifest) return [];
  return [
    ...new Set(
      manifest.modules
        .map((module) => DEV_PROFILE_BY_MODULE.get(module.name))
        .filter((profile): profile is string => profile !== undefined),
    ),
  ];
}

function routesToApi(config: DevConfig): boolean {
  return config.webSocketPaths.length > 0 || config.apiPaths.length > 0;
}

/** Traefik v3 matchers take one value each, so several paths are joined with ||. */
function anyOf(matchers: string[]): string {
  return matchers.length > 1 ? `(${matchers.join(" || ")})` : (matchers[0] ?? "");
}

export function renderRuntimeCompose(runtime: DevRuntime): string {
  const api = routesToApi(runtime.config)
    ? `  api:\n    networks:\n      ${GATEWAY_NETWORK}:\n        aliases: [${runtime.alias}-api]\n`
    : "";
  return `# Generated by podo dev. Do not edit.\nservices:\n  traefik:\n    profiles: [podokit-legacy-proxy]\n  web:\n    networks:\n      ${GATEWAY_NETWORK}:\n        aliases: [${runtime.alias}]\n${api}networks:\n  ${GATEWAY_NETWORK}:\n    external: true\n    name: ${GATEWAY_NETWORK}\n`;
}

export function renderRoute(runtime: DevRuntime): string {
  const { alias, config, routeId } = runtime;
  const hosts = routeHosts(config);
  const hostRule = hosts.map((host) => `Host(\`${host}\`)`).join(" || ");
  const scopedHostRule = hosts.length > 1 ? `(${hostRule})` : hostRule;
  const webSocketRouter = config.webSocketPaths.length
    ? `    ${routeId}-websocket:\n      entryPoints: [web]\n      rule: ${scopedHostRule} && ${anyOf(config.webSocketPaths.map((path) => `Path(\`${path}\`)`))}\n      priority: 100\n      service: ${routeId}-api\n`
    : "";
  const apiPathMatchers = config.apiPaths.flatMap((path) => {
    const base = apiPathBase(path);
    return [`Path(\`${base}\`)`, `PathPrefix(\`${base}/\`)`];
  });
  const apiPathRouter = config.apiPaths.length
    ? `    ${routeId}-api-paths:\n      entryPoints: [web]\n      rule: ${scopedHostRule} && ${anyOf(apiPathMatchers)}\n      priority: 100\n      middlewares: [${routeId}-api-prefix]\n      service: ${routeId}-api\n`
    : "";
  const apiService = routesToApi(config)
    ? `    ${routeId}-api:\n      loadBalancer:\n        servers:\n          - url: http://${alias}-api:5002\n`
    : "";
  const apiPrefixMiddleware = config.apiPaths.length
    ? `    ${routeId}-api-prefix:\n      stripPrefix:\n        prefixes: ["${API_PATH_PREFIX}"]\n`
    : "";
  return `http:\n  routers:\n${webSocketRouter}${apiPathRouter}    ${routeId}:\n      entryPoints: [web]\n      rule: ${hostRule}\n      service: ${routeId}\n      middlewares: [${routeId}-compression]\n  services:\n${apiService}    ${routeId}:\n      loadBalancer:\n        servers:\n          - url: http://${alias}:5001\n  middlewares:\n    ${routeId}-compression:\n      compress: {}\n${apiPrefixMiddleware}`;
}

function devHome(): string {
  return process.env.PODOKIT_DEV_HOME ?? join(homedir(), ".podokit", "dev-gateway");
}

function registryDirectory(): string {
  return join(devHome(), "projects");
}

function routesDirectory(): string {
  return join(devHome(), "routes");
}

function registryPath(runtime: DevRuntime): string {
  return join(registryDirectory(), `${runtime.routeId}.json`);
}

function routePath(runtime: DevRuntime): string {
  return join(routesDirectory(), `${runtime.routeId}.yml`);
}

interface RegistryEntry {
  hostname: string;
  publicUrl?: string;
  projectRoot: string;
  routeId: string;
}

function routeHosts(config: Pick<DevConfig, "hostname" | "publicUrl">): string[] {
  return [
    ...new Set([
      config.hostname,
      ...(config.publicUrl ? [new URL(config.publicUrl).hostname] : []),
    ]),
  ];
}

function activeEntries(): RegistryEntry[] {
  const dir = registryDirectory();
  if (!existsSync(dir)) return [];
  const entries: RegistryEntry[] = [];
  for (const name of readdirSync(dir).filter((entry) => entry.endsWith(".json"))) {
    const path = join(dir, name);
    const entry = parseJson<RegistryEntry>(path);
    if (!existsSync(entry.projectRoot)) {
      rmSync(path, { force: true });
      rmSync(join(routesDirectory(), `${entry.routeId}.yml`), { force: true });
      continue;
    }
    entries.push(entry);
  }
  return entries;
}

/**
 * Create the untracked `.env.docker` from the committed `.env.docker.example`
 * when it is missing, filling every empty `*_SECRET` value with a random one.
 * An existing file is never changed. Returns true when the file was created.
 */
export function ensureContainerEnv(projectRoot: string): boolean {
  const target = join(projectRoot, CONTAINER_ENV);
  if (existsSync(target)) return false;
  const example = join(projectRoot, CONTAINER_ENV_EXAMPLE);
  if (!existsSync(example)) {
    const compose = join(projectRoot, "compose.dev.yaml");
    if (existsSync(compose) && readFileSync(compose, "utf8").includes(CONTAINER_ENV)) {
      throw new Error(
        `${CONTAINER_ENV} is missing and there is no ${CONTAINER_ENV_EXAMPLE} to create it from. Run podo update --apply to add the example, or create ${CONTAINER_ENV} by hand.`,
      );
    }
    return false;
  }
  const content = readFileSync(example, "utf8").replace(
    GENERATED_SECRET,
    (_line, name: string, carriageReturn: string) =>
      `${name}=${randomBytes(32).toString("base64url")}${carriageReturn}`,
  );
  writeFileSync(target, content, { mode: 0o600 });
  process.stdout.write(`Created ${CONTAINER_ENV} from ${CONTAINER_ENV_EXAMPLE} with generated secrets.\n`);
  return true;
}

function writeRuntimeFiles(runtime: DevRuntime): void {
  mkdirSync(join(runtime.projectRoot, ".podokit", "runtime"), { recursive: true });
  writeFileSync(runtime.runtimeComposePath, renderRuntimeCompose(runtime));
}

function registerRoute(runtime: DevRuntime): void {
  const entries = activeEntries();
  const requestedHosts = new Set(routeHosts(runtime.config));
  const collision = entries.find((entry) =>
    entry.projectRoot !== runtime.projectRoot &&
    routeHosts(entry).some((hostname) => requestedHosts.has(hostname)),
  );
  if (collision) {
    const duplicate = routeHosts(collision).find((hostname) => requestedHosts.has(hostname));
    throw new Error(
      `Development host ${duplicate ?? runtime.config.hostname} is already registered by ${collision.projectRoot}. Change .podokit/dev.json or run podo dev down there.`,
    );
  }
  for (const stale of entries.filter(
    (entry) => entry.projectRoot === runtime.projectRoot && entry.routeId !== runtime.routeId,
  )) {
    rmSync(join(registryDirectory(), `${stale.routeId}.json`), { force: true });
    rmSync(join(routesDirectory(), `${stale.routeId}.yml`), { force: true });
  }
  mkdirSync(registryDirectory(), { recursive: true });
  mkdirSync(routesDirectory(), { recursive: true });
  writeFileSync(routePath(runtime), renderRoute(runtime));
  const entry: RegistryEntry = {
    hostname: runtime.config.hostname,
    ...(runtime.config.publicUrl ? { publicUrl: runtime.config.publicUrl } : {}),
    projectRoot: runtime.projectRoot,
    routeId: runtime.routeId,
  };
  writeFileSync(registryPath(runtime), `${JSON.stringify(entry, null, 2)}\n`);
}

function unregisterRoute(runtime: DevRuntime): void {
  rmSync(registryPath(runtime), { force: true });
  rmSync(routePath(runtime), { force: true });
}

function commandSucceeded(result: CommandResult): boolean {
  return result.status === 0;
}

function ensureDocker(runner: CommandRunner): void {
  const result = runner("docker", ["info", "--format", "{{.ServerVersion}}"], { capture: true });
  if (!commandSucceeded(result)) {
    throw new Error(`Docker is not available. ${result.stderr.trim()}`.trim());
  }
}

function ensureNetwork(runner: CommandRunner): void {
  const inspect = runner("docker", ["network", "inspect", GATEWAY_NETWORK], { capture: true });
  if (commandSucceeded(inspect)) return;
  const create = runner("docker", ["network", "create", GATEWAY_NETWORK], { capture: true });
  if (!commandSucceeded(create)) {
    throw new Error(`Cannot create Docker network ${GATEWAY_NETWORK}: ${create.stderr.trim()}`);
  }
}

function ensureGateway(runner: CommandRunner): void {
  const inspect = runner(
    "docker",
    [
      "inspect",
      "--format",
      `{{ index .Config.Labels \"${GATEWAY_LABEL}\" }} {{.State.Running}} {{ index .Config.Labels \"${GATEWAY_VERSION_LABEL}\" }}`,
      GATEWAY_CONTAINER,
    ],
    { capture: true },
  );
  if (commandSucceeded(inspect)) {
    const [label, running, version] = inspect.stdout.trim().split(/\s+/);
    if (label !== "1") {
      throw new Error(`Container ${GATEWAY_CONTAINER} exists but is not managed by PodoKit.`);
    }
    if (version === GATEWAY_VERSION) {
      if (running !== "true") {
        const start = runner("docker", ["start", GATEWAY_CONTAINER], { capture: true });
        if (!commandSucceeded(start)) {
          throw new Error(`Cannot start ${GATEWAY_CONTAINER}: ${start.stderr.trim()}`);
        }
      }
      return;
    }
    const remove = runner("docker", ["rm", "--force", GATEWAY_CONTAINER], { capture: true });
    if (!commandSucceeded(remove)) {
      throw new Error(`Cannot upgrade ${GATEWAY_CONTAINER}: ${remove.stderr.trim()}`);
    }
  }

  mkdirSync(routesDirectory(), { recursive: true });
  const run = runner(
    "docker",
    [
      "run",
      "--detach",
      "--name",
      GATEWAY_CONTAINER,
      "--label",
      `${GATEWAY_LABEL}=1`,
      "--label",
      `${GATEWAY_VERSION_LABEL}=${GATEWAY_VERSION}`,
      "--restart",
      "unless-stopped",
      "--network",
      GATEWAY_NETWORK,
      "--publish",
      "127.0.0.1:80:80",
      "--volume",
      `${routesDirectory()}:/etc/traefik/dynamic:ro`,
      GATEWAY_IMAGE,
      "--providers.file.directory=/etc/traefik/dynamic",
      "--providers.file.watch=true",
      "--entrypoints.web.address=:80",
      "--entrypoints.web.forwardedheaders.insecure=true",
      "--api.dashboard=false",
    ],
    { capture: true },
  );
  if (!commandSucceeded(run)) {
    throw new Error(
      `Cannot start the shared PodoKit gateway on 127.0.0.1:80. Stop the current port owner, then retry. ${run.stderr.trim()}`.trim(),
    );
  }
}

function composeArgs(runtime: DevRuntime, args: string[]): string[] {
  return ["compose", "-f", "compose.dev.yaml", "-f", runtime.runtimeComposePath, ...args];
}

function runCompose(runtime: DevRuntime, args: string[], runner: CommandRunner): void {
  const result = runner("docker", composeArgs(runtime, args), { capture: false });
  if (!commandSucceeded(result)) {
    throw new Error(`docker compose ${args.join(" ")} exited with status ${String(result.status)}.`);
  }
}

// Exit statuses of a Compose process stopped by SIGINT or SIGTERM.
const STOPPED_STATUSES = new Set([130, 143]);
const WATCH_STOP_TIMEOUT_MS = 10_000;

function pause(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/**
 * Process IDs of the Compose Watch that `podo dev watch` started for this
 * project. The project-specific runtime overlay path in the command line
 * identifies it, so watches of other projects never match.
 */
export function findWatchProcesses(runtime: DevRuntime, psOutput: string): number[] {
  const prefix = `compose ${composeArgs(runtime, []).slice(1).join(" ")} `;
  const pids: number[] = [];
  for (const line of psOutput.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!match?.[1] || !match[2]) continue;
    const start = match[2].indexOf(prefix);
    if (start === -1) continue;
    const tokens = match[2].slice(start + prefix.length).split(/\s+/);
    let index = 0;
    while (tokens[index] === "--profile" || tokens[index]?.startsWith("--profile=")) {
      index += tokens[index] === "--profile" ? 2 : 1;
    }
    if (tokens[index] === "watch") pids.push(Number(match[1]));
  }
  return pids;
}

function anyAlive(pids: number[], runner: CommandRunner): boolean {
  return pids.some((pid) => commandSucceeded(runner("kill", ["-0", String(pid)], { capture: true })));
}

/**
 * Stop this project's Compose Watch. Compose holds a per-project lock for as
 * long as it watches, so a watch left behind by `down` made the next
 * `podo dev watch` fail with "cannot take exclusive lock".
 */
function stopWatch(runtime: DevRuntime, runner: CommandRunner): void {
  let listing: CommandResult;
  try {
    listing = runner("ps", ["-A", "-ww", "-o", "pid=,args="], { capture: true });
  } catch {
    return;
  }
  if (!commandSucceeded(listing)) return;
  const pids = findWatchProcesses(runtime, listing.stdout);
  if (pids.length === 0) return;
  runner("kill", ["-TERM", ...pids.map(String)], { capture: true });
  const deadline = Date.now() + WATCH_STOP_TIMEOUT_MS;
  while (anyAlive(pids, runner)) {
    if (Date.now() >= deadline) {
      runner("kill", ["-KILL", ...pids.map(String)], { capture: true });
      break;
    }
    pause(100);
  }
  process.stdout.write(`Stopped podo dev watch for this project (pid ${pids.join(", ")}).\n`);
}

function composeCommand(
  action: "down" | "exec" | "logs" | "ps" | "up" | "watch",
  args: string[],
  installedProfiles: string[],
): string[] {
  const global: string[] = [];
  const command: string[] = [];
  const explicitProfiles = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === undefined) continue;
    if (value === "--profile") {
      const profile = args[index + 1];
      if (!profile) throw new Error("--profile requires a value.");
      global.push(value, profile);
      explicitProfiles.add(profile);
      index += 1;
    } else if (value.startsWith("--profile=")) {
      global.push(value);
      explicitProfiles.add(value.slice("--profile=".length));
    } else {
      command.push(value);
    }
  }
  // Compose Watch syncs edits into the running containers, not into the image.
  // A plain `up` that recreates a container would start it from the last
  // built image and drop those edits, so `up` rebuilds unless told otherwise.
  if (action === "up" && !command.includes("--build") && !command.includes("--no-build")) {
    command.unshift("--build");
  }
  const activeProfiles =
    action === "down"
      ? ["--profile", "*"]
      : installedProfiles
          .filter((profile) => !explicitProfiles.has(profile))
          .flatMap((profile) => ["--profile", profile]);
  return [...activeProfiles, ...global, action, ...command];
}

function stopGatewayWhenUnused(runner: CommandRunner): void {
  if (activeEntries().length > 0) return;
  runner("docker", ["rm", "--force", GATEWAY_CONTAINER], { capture: true });
  runner("docker", ["network", "rm", GATEWAY_NETWORK], { capture: true });
}

const DOCKER_ACTIONS = new Set(["watch", "up", "exec", "logs", "ps", "down"]);

export function runDevCommand(
  projectRoot: string,
  action: string | undefined,
  args: string[],
  runner: CommandRunner = defaultRunner,
): void {
  const runtime = resolveDevRuntime(projectRoot);
  const profiles = installedDevProfiles(projectRoot);
  writeRuntimeFiles(runtime);

  if (action === "url") {
    process.stdout.write(`http://${runtime.config.hostname}\n`);
    if (runtime.config.publicUrl) process.stdout.write(`${runtime.config.publicUrl}\n`);
    return;
  }

  if (!DOCKER_ACTIONS.has(action ?? "") && action !== "env") {
    throw new Error("Usage: podo dev <watch|up|exec|logs|ps|down|url|env> [docker compose options]");
  }
  // Git ignores .env.docker, so a fresh clone gets it from the committed example.
  const createdEnv = ensureContainerEnv(projectRoot);
  if (action === "env") {
    if (!createdEnv) process.stdout.write(`${CONTAINER_ENV} already exists; left unchanged.\n`);
    return;
  }

  ensureDocker(runner);
  if (action === "watch") {
    ensureNetwork(runner);
    registerRoute(runtime);
    try {
      ensureGateway(runner);
      process.stdout.write(`Development URL: http://${runtime.config.hostname}\n`);
      if (runtime.config.publicUrl) process.stdout.write(`Public OAuth URL: ${runtime.config.publicUrl}\n`);
      const watchArgs = composeCommand("watch", args, profiles);
      const result = runner("docker", composeArgs(runtime, watchArgs), { capture: false });
      if (!commandSucceeded(result)) {
        // `podo dev down` or Ctrl+C ends the watch with SIGTERM or SIGINT.
        if (result.status !== null && STOPPED_STATUSES.has(result.status)) {
          unregisterRoute(runtime);
          stopGatewayWhenUnused(runner);
          process.stdout.write("Stopped watching.\n");
          return;
        }
        throw new Error(`docker compose ${watchArgs.join(" ")} exited with status ${String(result.status)}.`);
      }
    } catch (error) {
      unregisterRoute(runtime);
      stopGatewayWhenUnused(runner);
      throw error;
    }
    return;
  }

  if (action === "up") {
    ensureNetwork(runner);
    registerRoute(runtime);
    try {
      ensureGateway(runner);
      process.stdout.write(`Development URL: http://${runtime.config.hostname}\n`);
      if (runtime.config.publicUrl) process.stdout.write(`Public OAuth URL: ${runtime.config.publicUrl}\n`);
      runCompose(runtime, composeCommand("up", args, profiles), runner);
    } catch (error) {
      unregisterRoute(runtime);
      stopGatewayWhenUnused(runner);
      throw error;
    }
    return;
  }

  if (action === "down") {
    stopWatch(runtime, runner);
    runCompose(runtime, composeCommand("down", args, profiles), runner);
    unregisterRoute(runtime);
    stopGatewayWhenUnused(runner);
    return;
  }

  if (action === "exec" || action === "logs" || action === "ps") {
    runCompose(runtime, composeCommand(action, args, profiles), runner);
  }
}
