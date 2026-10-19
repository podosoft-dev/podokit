import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { constants as osConstants, homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { API_PATH_PREFIX, apiPathBase, parseApiPaths } from "./api-paths";
import { readManifest } from "./lockfile";
import { parseExactWebSocketPaths } from "./websocket-paths";

const GATEWAY_CONTAINER = "podokit-dev-gateway";
const GATEWAY_IMAGE = "traefik:v3.5";
const GATEWAY_LABEL = "io.podosoft.podokit.dev-gateway";
const GATEWAY_VERSION = "2";
const GATEWAY_VERSION_LABEL = "io.podosoft.podokit.dev-gateway.version";
const GATEWAY_NETWORK = "podokit-dev-gateway";
const GATEWAY_LINK_CONFIG = "podokit-gateway-link";
/** The network every service of the template's compose.dev.yaml joins. */
const PROJECT_NETWORK = "podokit";
const WEB_PORT = 5001;
const API_PORT = 5002;
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
  /** Browser origins of the development stack, for CORS_ORIGIN. */
  origins: string[];
  /** BETTER_AUTH_URL for the containers. */
  authUrl: string;
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

/** A process that `podo dev watch` runs while it watches. */
export interface StartedProcess {
  /** Resolves with the exit status; a process ended by a signal counts as 128 plus its number. */
  exited: Promise<number | null>;
  stop(): void;
}

/**
 * Starts a process without waiting for it. With `onLine` its standard output
 * goes to that callback line by line instead of the terminal.
 */
export type ProcessStarter = (
  command: string,
  args: string[],
  onLine?: (line: string) => void,
) => StartedProcess;

function defaultStarter(
  command: string,
  args: string[],
  onLine?: (line: string) => void,
): StartedProcess {
  const child = spawn(command, args, {
    stdio: onLine ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (onLine && child.stdout) createInterface({ input: child.stdout }).on("line", onLine);
  const exited = new Promise<number | null>((resolveExit) => {
    child.once("error", () => resolveExit(null));
    child.once("exit", (code, signal) =>
      resolveExit(code ?? (signal ? 128 + (osConstants.signals[signal] ?? 0) : null)),
    );
  });
  return {
    exited,
    stop: () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    },
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

/**
 * The origins a browser reaches the development stack on: the gateway
 * hostname, the HTTPS tunnel origin when one is declared, and plain localhost
 * for the compose file's own proxy.
 */
export function devOrigins(config: Pick<DevConfig, "hostname" | "publicUrl">): string[] {
  return [
    ...new Set([
      `http://${config.hostname}`,
      ...(config.publicUrl ? [new URL(config.publicUrl).origin] : []),
      "http://localhost",
    ]),
  ];
}

/**
 * Template variables for files that name the development host. They follow
 * `.podokit/dev.json` when it exists and is valid, so a renamed host renders
 * the same way it is routed; otherwise the project name's default.
 */
export function devTemplateVars(projectName: string, projectRoot?: string): Record<string, string> {
  let config: Pick<DevConfig, "hostname" | "publicUrl"> = { hostname: `${projectName}.localhost` };
  const path = projectRoot ? join(projectRoot, DEV_CONFIG) : undefined;
  if (path && existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<DevConfig>;
      if (typeof parsed.hostname === "string") {
        validateHostname(parsed.hostname);
        if (parsed.publicUrl) validatePublicUrl(parsed.publicUrl);
        config = { hostname: parsed.hostname, publicUrl: parsed.publicUrl };
      }
    } catch {
      // podo dev reports an unreadable dev.json; rendering keeps the default.
    }
  }
  return {
    devHostname: config.hostname,
    devCorsOrigin: devOrigins(config).join(","),
    devAuthUrl: `http://${config.hostname}`,
  };
}

/**
 * BETTER_AUTH_URL for the containers: the gateway origin, or the origin named
 * by PODOKIT_DEV_AUTH_URL for an OAuth round trip through `publicUrl`.
 */
function devAuthUrl(config: DevConfig, origins: string[]): string {
  const requested = process.env.PODOKIT_DEV_AUTH_URL?.trim();
  if (!requested) return `http://${config.hostname}`;
  let origin: string;
  try {
    origin = new URL(requested).origin;
  } catch {
    origin = "";
  }
  if (!origins.includes(origin) || origin === "http://localhost") {
    throw new Error(
      `PODOKIT_DEV_AUTH_URL must be http://${config.hostname}${config.publicUrl ? ` or ${new URL(config.publicUrl).origin}` : ""} (from ${DEV_CONFIG}).`,
    );
  }
  return origin;
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
  const origins = devOrigins(config);
  return {
    alias: `podokit-${projectSlug}-${id}`,
    config,
    origins,
    authUrl: devAuthUrl(config, origins),
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

/**
 * The compose overlay `podo dev` adds. It sets CORS_ORIGIN and BETTER_AUTH_URL
 * for web and api from `.podokit/dev.json`, so the browser origins follow the
 * routed hostname whatever `.env.docker` says, and adds the project's gateway
 * link.
 *
 * Compose registers every service under its plain name on each network it
 * joins, so web and api must stay off the shared gateway network: there, a web
 * container resolved `api` to whichever project's API answered. Only the link
 * joins both networks. Its service name is the project's unique alias, and it
 * passes TCP connections through to web and api by their project-network
 * aliases, so the proxy headers the gateway sets reach them unchanged.
 */
export function renderRuntimeCompose(runtime: DevRuntime): string {
  const { alias } = runtime;
  const api = routesToApi(runtime.config);
  const environment =
    `    environment:\n` +
    `      CORS_ORIGIN: ${JSON.stringify(runtime.origins.join(","))}\n` +
    `      BETTER_AUTH_URL: ${JSON.stringify(runtime.authUrl)}\n`;
  // The API applies pending migrations before each development start, so one
  // that arrives with a pull or a rebase reaches the database (see the
  // template's src/database/development-migrations.ts).
  const apiEnvironment = `${environment}      PODOKIT_DEV_MIGRATE: "true"\n`;
  const forwards = [
    { name: "web", address: `${alias}-web:${WEB_PORT}`, port: WEB_PORT },
    ...(api ? [{ name: "api", address: `${alias}-api:${API_PORT}`, port: API_PORT }] : []),
  ];
  const linkConfig =
    `      tcp:\n        routers:\n` +
    forwards
      .map(
        ({ name }) =>
          `          ${name}:\n            entryPoints: [${name}]\n            rule: HostSNI(\`*\`)\n            service: ${name}\n`,
      )
      .join("") +
    `        services:\n` +
    forwards
      .map(
        ({ name, address }) =>
          `          ${name}:\n            loadBalancer:\n              servers:\n                - address: ${address}\n`,
      )
      .join("");
  // The entry points also change the command whenever the forwards change, so
  // Compose recreates the link instead of keeping the old configuration.
  // Until the link loads its TCP routers, Traefik serves a connection it accepts
  // as HTTP and answers 404, and keeps doing so for that connection's life. The
  // gateway pools its connections, so one dialed while the link started kept
  // returning 404 for minutes. Closing every connection the link answers itself
  // after one response drops it; passed-through connections stay open.
  const linkCommand = [
    "--providers.file.filename=/etc/traefik/link.yml",
    ...forwards.flatMap(({ name, port }) => [
      `--entrypoints.${name}.address=:${port}`,
      `--entrypoints.${name}.transport.keepAliveMaxRequests=1`,
    ]),
    "--global.checknewversion=false",
    "--global.sendanonymoususage=false",
  ]
    .map((flag) => `      - ${flag}\n`)
    .join("");
  return (
    `# Generated by podo dev. Do not edit.\n` +
    `services:\n` +
    `  traefik:\n    profiles: [podokit-legacy-proxy]\n` +
    `  web:\n${environment}    depends_on: [${alias}]\n` +
    `    networks:\n      ${PROJECT_NETWORK}:\n        aliases: [${alias}-web]\n` +
    `  api:\n${apiEnvironment}` +
    `    networks:\n      ${PROJECT_NETWORK}:\n        aliases: [${alias}-api]\n` +
    `  ${alias}:\n` +
    `    image: ${GATEWAY_IMAGE}\n` +
    `    mem_limit: \${GATEWAY_LINK_MEM_LIMIT:-128m}\n` +
    `    memswap_limit: \${GATEWAY_LINK_MEM_LIMIT:-128m}\n` +
    `    command:\n${linkCommand}` +
    `    configs:\n      - source: ${GATEWAY_LINK_CONFIG}\n        target: /etc/traefik/link.yml\n` +
    `    networks: [${PROJECT_NETWORK}, ${GATEWAY_NETWORK}]\n` +
    `configs:\n  ${GATEWAY_LINK_CONFIG}:\n    content: |\n${linkConfig}` +
    `networks:\n  ${GATEWAY_NETWORK}:\n    external: true\n    name: ${GATEWAY_NETWORK}\n`
  );
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
    ? `    ${routeId}-api:\n      loadBalancer:\n        servers:\n          - url: http://${alias}:${API_PORT}\n`
    : "";
  const apiPrefixMiddleware = config.apiPaths.length
    ? `    ${routeId}-api-prefix:\n      stripPrefix:\n        prefixes: ["${API_PATH_PREFIX}"]\n`
    : "";
  return `http:\n  routers:\n${webSocketRouter}${apiPathRouter}    ${routeId}:\n      entryPoints: [web]\n      rule: ${hostRule}\n      service: ${routeId}\n      middlewares: [${routeId}-compression]\n  services:\n${apiService}    ${routeId}:\n      loadBalancer:\n        servers:\n          - url: http://${alias}:${WEB_PORT}\n  middlewares:\n    ${routeId}-compression:\n      compress: {}\n${apiPrefixMiddleware}`;
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
  action: "config" | "down" | "exec" | "logs" | "ps" | "up" | "watch",
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

// Compose Watch options that take no value and apply to its own `up` too.
const WATCH_UP_FLAGS = new Set(["--dry-run"]);

/**
 * The commands of `podo dev watch`: an `up --build --detach` from the current
 * work tree, then a Watch that does not start anything itself. Watch's own `up`
 * reused the last built image, and its first sync copies only later edits, so a
 * container it recreated, for example after a memory limit change, ran the
 * source of the last build, deleted files included. `--no-build` starts from
 * the existing images instead, and `--no-up` keeps the running containers.
 */
export function watchCommands(
  args: string[],
  installedProfiles: string[],
): { up?: string[]; watch: string[] } {
  const noBuild = args.includes("--no-build");
  const watchArgs = args.filter((value) => value !== "--no-build");
  if (watchArgs.includes("--no-up")) {
    if (noBuild) throw new Error("--no-build has no effect with --no-up; pass one of them.");
    return { watch: composeCommand("watch", watchArgs, installedProfiles) };
  }
  const upArgs: string[] = [];
  for (let index = 0; index < watchArgs.length; index += 1) {
    const value = watchArgs[index];
    if (value === undefined) continue;
    if (value === "--profile") {
      upArgs.push(value, watchArgs[index + 1] ?? "");
      index += 1;
    } else if (value.startsWith("--profile=") || WATCH_UP_FLAGS.has(value) || !value.startsWith("-")) {
      upArgs.push(value);
    }
  }
  const services = upArgs.filter((value, index) => !value.startsWith("-") && upArgs[index - 1] !== "--profile");
  const options = upArgs.filter((value) => !services.includes(value));
  return {
    up: composeCommand(
      "up",
      [...options, "--detach", ...(noBuild ? ["--no-build"] : []), ...services],
      installedProfiles,
    ),
    watch: composeCommand("watch", [...watchArgs, "--no-up"], installedProfiles),
  };
}

const SYNC_ACTIONS = new Set(["sync", "sync+restart", "sync+exec"]);

interface ComposeConfig {
  name?: unknown;
  services?: Record<string, { develop?: { watch?: Array<{ action?: unknown; path?: unknown }> } }>;
}

/** The Compose project name and, per service, the host paths its Watch syncs. */
export function watchedSyncPaths(configJson: string): { project: string; services: Map<string, string[]> } {
  const config = JSON.parse(configJson) as ComposeConfig;
  if (typeof config.name !== "string") throw new Error("docker compose config did not name the project.");
  const services = new Map<string, string[]>();
  for (const [service, definition] of Object.entries(config.services ?? {})) {
    const paths = (definition.develop?.watch ?? [])
      .filter((trigger) => typeof trigger.action === "string" && SYNC_ACTIONS.has(trigger.action))
      .flatMap((trigger) => (typeof trigger.path === "string" ? [trigger.path] : []));
    if (paths.length > 0) services.set(service, paths);
  }
  return { project: config.name, services };
}

// Folders a synced path may hold that Watch ignores or the container builds.
const UNSYNCED_FOLDERS = new Set(["node_modules", ".git", ".svelte-kit"]);

/**
 * The latest modification time, in milliseconds, of the paths and every file
 * and folder below them. A deletion changes its folder's time, so it counts.
 */
export function newestModification(paths: string[]): number {
  let newest = 0;
  const visit = (path: string): void => {
    let stats;
    try {
      stats = lstatSync(path);
    } catch {
      return;
    }
    newest = Math.max(newest, stats.mtimeMs);
    if (!stats.isDirectory()) return;
    for (const entry of readdirSync(path)) {
      if (!UNSYNCED_FOLDERS.has(entry)) visit(join(path, entry));
    }
  };
  for (const path of paths) visit(path);
  return newest;
}

function imageCreatedAt(containerId: string, runner: CommandRunner): number | null {
  const container = runner("docker", ["inspect", "--format", "{{.Image}}", containerId], { capture: true });
  if (!commandSucceeded(container)) return null;
  const image = runner("docker", ["image", "inspect", "--format", "{{.Created}}", container.stdout.trim()], {
    capture: true,
  });
  if (!commandSucceeded(image)) return null;
  const created = Date.parse(image.stdout.trim());
  return Number.isNaN(created) ? null : created;
}

/**
 * Runs Compose Watch and rebuilds a service whose container something else
 * recreated from an image older than the synced files, such as `docker compose
 * up --no-build` after a memory limit change. Watch syncs only edits made
 * after it starts, so such a container kept running the source of the last
 * build. A restart keeps the container and its synced files, so only a new
 * container is checked. Resolves with Watch's exit status.
 */
async function superviseWatch(
  runtime: DevRuntime,
  watch: string[],
  rebuildAllowed: boolean,
  profileArgs: string[],
  runner: CommandRunner,
  starter: ProcessStarter,
): Promise<number | null> {
  const config = runner("docker", composeArgs(runtime, [...profileArgs, "config", "--format", "json"]), {
    capture: true,
  });
  let watched: ReturnType<typeof watchedSyncPaths>;
  try {
    if (!commandSucceeded(config)) throw new Error(config.stderr.trim() || `status ${String(config.status)}`);
    watched = watchedSyncPaths(config.stdout);
  } catch (error) {
    process.stderr.write(
      `podo dev: cannot read the Compose configuration (${(error as Error).message}), so a recreated container is not checked for older source.\n`,
    );
    return starter("docker", composeArgs(runtime, watch)).exited;
  }
  const { project, services } = watched;
  const listed = runner("docker", composeArgs(runtime, [...profileArgs, "ps", "--all", "--quiet"]), {
    capture: true,
  });
  const known = new Set(listed.stdout.split("\n").map((id) => id.trim()).filter(Boolean));

  const watcher = starter("docker", composeArgs(runtime, watch));
  const events = starter(
    "docker",
    [
      "events",
      "--filter",
      `label=com.docker.compose.project=${project}`,
      "--filter",
      "type=container",
      "--filter",
      "event=start",
      "--format",
      '{{.Actor.ID}} {{index .Actor.Attributes "com.docker.compose.service"}} {{index .Actor.Attributes "com.docker.compose.oneoff"}}',
    ],
    (line) => {
      const [id, service, oneOff] = line.trim().split(/\s+/);
      // A `docker compose run` container carries its service's label but is
      // not that service: rebuilding the service for it recreated the running one.
      if (!id || !service || oneOff === "True" || known.has(id)) return;
      known.add(id);
      const paths = services.get(service);
      if (!paths) return;
      const created = imageCreatedAt(id, runner);
      if (created === null || newestModification(paths) <= created) return;
      if (!rebuildAllowed) {
        process.stdout.write(
          `podo dev: ${service} was recreated from an image older than its synced files, so it runs older source. Run podo dev up -d ${service} to rebuild it.\n`,
        );
        return;
      }
      process.stdout.write(
        `podo dev: ${service} was recreated from an image older than its synced files; rebuilding it from the work tree.\n`,
      );
      const rebuild = composeArgs(runtime, [...profileArgs, "up", "--build", "--detach", "--no-deps", service]);
      const result = runner("docker", rebuild, { capture: false });
      if (!commandSucceeded(result)) {
        process.stderr.write(
          `podo dev: rebuilding ${service} failed with status ${String(result.status)}; run podo dev up -d ${service}.\n`,
        );
      }
    },
  );
  // Ctrl+C reaches Watch, which then exits; a signal sent to podo alone stops it.
  const stop = (): void => watcher.stop();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    return await watcher.exited;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    events.stop();
  }
}

function stopGatewayWhenUnused(runner: CommandRunner): void {
  if (activeEntries().length > 0) return;
  runner("docker", ["rm", "--force", GATEWAY_CONTAINER], { capture: true });
  runner("docker", ["network", "rm", GATEWAY_NETWORK], { capture: true });
}

const DOCKER_ACTIONS = new Set(["watch", "up", "exec", "logs", "ps", "down"]);

export async function runDevCommand(
  projectRoot: string,
  action: string | undefined,
  args: string[],
  runner: CommandRunner = defaultRunner,
  starter: ProcessStarter = defaultStarter,
): Promise<void> {
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
      const commands = watchCommands(args, profiles);
      const stopped = (): void => {
        unregisterRoute(runtime);
        stopGatewayWhenUnused(runner);
        process.stdout.write("Stopped watching.\n");
      };
      if (commands.up) {
        const result = runner("docker", composeArgs(runtime, commands.up), { capture: false });
        if (!commandSucceeded(result)) {
          if (result.status !== null && STOPPED_STATUSES.has(result.status)) return stopped();
          throw new Error(`docker compose ${commands.up.join(" ")} exited with status ${String(result.status)}.`);
        }
      }
      const watchIndex = commands.watch.indexOf("watch");
      const status = await superviseWatch(
        runtime,
        commands.watch,
        !args.includes("--no-build"),
        commands.watch.slice(0, watchIndex),
        runner,
        starter,
      );
      // `podo dev down` or Ctrl+C ends the watch with SIGTERM or SIGINT.
      if (status !== null && STOPPED_STATUSES.has(status)) return stopped();
      if (status !== 0) {
        throw new Error(`docker compose ${commands.watch.join(" ")} exited with status ${String(status)}.`);
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
