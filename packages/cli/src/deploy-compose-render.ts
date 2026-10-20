import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { API_PATH_PREFIX, apiPathBase } from "./api-paths";
import {
  composeGatewayIsTransparent,
  type ComposeDependencyProfile,
  type ComposeWorkloadProfile,
  type DockerComposeProfileV1,
} from "./deploy-compose-profile";
import { readAppProxyTimeouts, type AppProxyTimeouts } from "./app-proxy-timeouts";
import {
  idleTimeoutConfig,
  profilePath,
  proxyTrustConfig,
  shutdownDrainSeconds,
} from "./deploy-schema";
import { readManifest } from "./lockfile";
import {
  resolveToolchain,
  toolchainMigrationCommand,
  toolchainWorkerCommand,
} from "./toolchain";

/**
 * Compose project rendering.
 *
 * The Kubernetes driver renders Helm charts; this one renders a single Compose file
 * plus a one-shot migration file. Both are written into `.podokit/runtime/deploy/`
 * and both are pure functions of the profile, the release, and the resolved image
 * digests — so the same inputs always produce the same bytes, which is what lets the
 * plan hash mean anything.
 */

export interface ComposeRuntime {
  root: string;
  composeFile: string;
  migrationFile: string;
  composeDocument: string;
  migrationDocument: string;
}

export interface ComposeImages {
  api: string;
  web: string;
  gateway: string | null;
  postgres: string | null;
  redis: string | null;
  objectStorage: string | null;
  objectStorageClient: string | null;
}

/** The internal port every generated application service listens on. */
const CONTAINER_PORT = 3000;

/**
 * Bun caches a host name's addresses for 30 seconds and keeps connecting to a
 * cached address after it stops answering. The web server reaches the API by its
 * service name, which a rollout moves to new containers, so with the cache it
 * would keep calling the old API's address after that container is gone.
 */
const WEB_DNS_CONFIG: Record<string, string> = { BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS: "0" };

/**
 * Seconds Docker waits after SIGTERM before it kills an application container.
 * Its default is 10, while the API and web servers drain in-flight requests for
 * SHUTDOWN_TIMEOUT (30) and then force-close for up to one more, and the API
 * closes its services within three. API and web get that drain plus a margin, the Kubernetes grace period without its preStop
 * sleep; the worker gets the 30 s it keeps on Kubernetes. Dependencies and the
 * gateway keep Docker's default: a changed definition makes Compose recreate
 * them, which would restart a database or close the published port on the first
 * apply after an upgrade.
 */
const SHUTDOWN_MARGIN_SECONDS = 5;
const WORKER_STOP_GRACE_SECONDS = 30;

export function composeStopGraceSeconds(
  role: "api" | "web" | "worker",
  runtimeConfig: Record<string, string>,
): number {
  return role === "worker"
    ? WORKER_STOP_GRACE_SECONDS
    : shutdownDrainSeconds(runtimeConfig) + SHUTDOWN_MARGIN_SECONDS;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function digest(parts: string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\0");
  return `sha256:${hash.digest("hex")}`;
}

export function serviceName(profile: DockerComposeProfileV1, role: string): string {
  return `${profile.target.project}-${role}`;
}

/**
 * Configuration PodoKit derives rather than accepts, so a profile cannot point the
 * app at the wrong service or port.
 */
export function derivedRuntimeConfig(
  profile: DockerComposeProfileV1,
  proxyTimeouts: AppProxyTimeouts,
): Record<string, string> {
  const result: Record<string, string> = {
    PORT: String(CONTAINER_PORT),
    BACKEND_INTERNAL_URL: `http://${serviceName(profile, "api")}:${CONTAINER_PORT}`,
    ...idleTimeoutConfig(profile.runtimeConfig, proxyTimeouts),
    ...composeProxyTrust(profile),
    ...profile.runtimeConfig,
  };
  if (profile.dependencies.postgres.mode === "managed") {
    result.POSTGRES_HOST = serviceName(profile, "postgres");
    result.POSTGRES_PORT = "5432";
  }
  if (profile.dependencies.redis.mode === "managed") {
    result.REDIS_HOST = serviceName(profile, "redis");
    result.REDIS_PORT = "6379";
  }
  if (profile.dependencies.objectStorage.mode === "managed") {
    result.S3_ENDPOINT = `http://${serviceName(profile, "object-storage")}:9000`;
    result.S3_BUCKET = profile.dependencies.objectStorage.bucket;
    result.S3_FORCE_PATH_STYLE = "true";
  }
  return result;
}

/**
 * A transparent gateway appends its peer to X-Forwarded-For and passes the edge
 * proxies' forwarded headers on, so the web server counts it as one more hop and
 * trusts the forwarded origin only behind an edge proxy, as it would without it.
 * Otherwise the gateway replaces X-Forwarded-For with the one address it resolved.
 * It keeps a trusted proxy's X-Forwarded-Proto and X-Forwarded-Host and otherwise
 * writes its own, which name its plain-HTTP listener: behind an edge proxy it does
 * not trust, the web server keeps its default origin (https and the Host header).
 */
export function composeProxyTrust(profile: DockerComposeProfileV1): Record<string, string> {
  const { edgeProxies, trustedProxyCidrs } = profile.exposure;
  return composeGatewayIsTransparent(profile)
    ? proxyTrustConfig(edgeProxies + 1, edgeProxies > 0)
    : proxyTrustConfig(1, edgeProxies === 0 || trustedProxyCidrs.length > 0);
}

function sortedEnvironment(config: Record<string, string>): [string, string][] {
  return Object.entries(config).sort(([left], [right]) => left.localeCompare(right));
}

function environmentBlock(config: Record<string, string>, indent: string): string {
  const entries = sortedEnvironment(config);
  if (!entries.length) return "";
  return `${indent}environment:\n${entries
    .map(([key, value]) => `${indent}  ${key}: ${quote(value)}`)
    .join("\n")}\n`;
}

/**
 * Identity of everything the containers read but Compose cannot see a change in.
 *
 * Compose recreates a container when its definition changes; it has no idea an env
 * file on the host was edited. Stamping this digest as a label makes an edited
 * secret or a changed runtime config a definition change, so `up` actually rolls
 * the containers instead of leaving stale values running.
 */
export function rolloutStateDigest(
  profile: DockerComposeProfileV1,
  secretIdentities: Record<string, string>,
  proxyTimeouts: AppProxyTimeouts,
): string {
  return digest([
    "compose-rollout-state",
    JSON.stringify(sortedEnvironment(derivedRuntimeConfig(profile, proxyTimeouts))),
    JSON.stringify(Object.entries(secretIdentities).sort(([l], [r]) => l.localeCompare(r))),
  ]);
}

function resourceBlock(workload: ComposeWorkloadProfile, indent: string): string {
  return (
    `${indent}deploy:\n` +
    `${indent}  replicas: ${workload.replicas}\n` +
    `${indent}  resources:\n` +
    `${indent}    limits:\n` +
    `${indent}      cpus: ${quote(workload.resources.cpuLimit)}\n` +
    `${indent}      memory: ${workload.resources.memoryLimit}\n`
  );
}

/**
 * An HTTP readiness probe that needs nothing the runtime image does not already
 * have. The application images are Node, and Node 22 has a global `fetch`, so this
 * avoids making `curl` or `wget` a deployment dependency.
 */
function httpHealthcheck(path: string, indent: string): string {
  const probe =
    `fetch('http://127.0.0.1:${CONTAINER_PORT}${path}')` +
    `.then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))`;
  return (
    `${indent}healthcheck:\n` +
    `${indent}  test: ["CMD", "node", "-e", ${quote(probe)}]\n` +
    `${indent}  interval: 10s\n` +
    `${indent}  timeout: 5s\n` +
    `${indent}  retries: 6\n` +
    `${indent}  start_period: 30s\n`
  );
}

function labelsBlock(
  profile: DockerComposeProfileV1,
  release: string,
  stateDigest: string,
  indent: string,
): string {
  return (
    `${indent}labels:\n` +
    `${indent}  io.podokit.project: ${quote(profile.target.project)}\n` +
    `${indent}  io.podokit.release: ${quote(release)}\n` +
    `${indent}  io.podokit.rollout-state: ${quote(stateDigest)}\n`
  );
}

function dependencyService(
  profile: DockerComposeProfileV1,
  role: string,
  dependency: ComposeDependencyProfile,
  image: string,
  extra: { command?: string; healthcheck: string; dataPath: string },
): string {
  return (
    `  ${serviceName(profile, role)}:\n` +
    `    image: ${quote(image)}\n` +
    `    restart: unless-stopped\n` +
    (extra.command ? `    command: ${extra.command}\n` : "") +
    `    env_file:\n      - ${quote(dependency.envFile)}\n` +
    `    volumes:\n      - ${quote(`${dependency.volume}:${extra.dataPath}`)}\n` +
    `    networks: [${profile.target.project}]\n` +
    extra.healthcheck
  );
}

function postgresService(profile: DockerComposeProfileV1, image: string): string {
  const { maxConnections } = profile.dependencies.postgres;
  return dependencyService(profile, "postgres", profile.dependencies.postgres, image, {
    dataPath: "/var/lib/postgresql/data",
    // The image's entry point runs postgres with arguments that start with "-".
    ...(maxConnections === undefined
      ? {}
      : { command: `["-c", ${quote(`max_connections=${maxConnections}`)}]` }),
    healthcheck:
      `    healthcheck:\n` +
      `      test: ["CMD-SHELL", "pg_isready -U \\"$$POSTGRES_USER\\" -d \\"$$POSTGRES_DB\\""]\n` +
      `      interval: 10s\n      timeout: 5s\n      retries: 10\n      start_period: 20s\n`,
  });
}

function redisService(profile: DockerComposeProfileV1, image: string): string {
  return dependencyService(profile, "redis", profile.dependencies.redis, image, {
    dataPath: "/data",
    // Authenticated and durable, matching what the Kubernetes driver renders.
    command: `["sh", "-c", ${quote(
      'exec redis-server --appendonly yes --requirepass "$$REDIS_PASSWORD"',
    )}]`,
    healthcheck:
      `    healthcheck:\n` +
      `      test: ["CMD-SHELL", "redis-cli -a \\"$$REDIS_PASSWORD\\" ping | grep -q PONG"]\n` +
      `      interval: 10s\n      timeout: 5s\n      retries: 10\n      start_period: 10s\n`,
  });
}

function objectStorageService(profile: DockerComposeProfileV1, image: string): string {
  return dependencyService(
    profile,
    "object-storage",
    profile.dependencies.objectStorage,
    image,
    {
      dataPath: "/data",
      command: `["server", "/data", "--address", ":9000", "--console-address", ":9001"]`,
      healthcheck:
        `    healthcheck:\n` +
        `      test: ["CMD", "mc", "ready", "local"]\n` +
        `      interval: 10s\n      timeout: 5s\n      retries: 10\n      start_period: 15s\n`,
    },
  );
}

/**
 * Creates the bucket and a least-privilege application user, then exits. Compose
 * runs it as a normal service with `restart: "no"`, which is the closest thing it
 * has to a Job.
 */
function objectStorageInitService(profile: DockerComposeProfileV1, clientImage: string): string {
  const storage = profile.dependencies.objectStorage;
  const endpoint = `http://${serviceName(profile, "object-storage")}:9000`;
  // `$$` is Compose's escape: a single `$` would be substituted at parse time,
  // from the environment of whoever runs compose, and these values only exist in
  // the env file the container reads.
  // The least-privilege policy the application user gets: its own bucket, nothing
  // else. It is written here rather than referenced, because a policy file that the
  // job does not create is a policy that never gets attached -- the user is then
  // created with no permissions at all and every object operation fails, which
  // surfaces as a readiness check that is down for no visible reason.
  const policy = JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: ["s3:*"],
        Resource: [`arn:aws:s3:::${storage.bucket}`, `arn:aws:s3:::${storage.bucket}/*`],
      },
    ],
  });
  const script = [
    "set -e",
    `mc alias set podokit ${endpoint} "$$MINIO_ROOT_USER" "$$MINIO_ROOT_PASSWORD"`,
    `mc mb --ignore-existing podokit/${storage.bucket}`,
    `mc admin user add podokit "$$S3_ACCESS_KEY_ID" "$$S3_SECRET_ACCESS_KEY" || true`,
    `printf '%s' '${policy}' > /tmp/podokit-policy.json`,
    `mc admin policy create podokit podokit-app /tmp/podokit-policy.json || true`,
    `mc admin policy attach podokit podokit-app --user "$$S3_ACCESS_KEY_ID" || true`,
    // Prove the attachment, or the job reports success while the user still cannot
    // read its own bucket. Checked with shell builtins only: the mc image is
    // minimal and has no grep, so a pipeline into one exits 127 and takes the job
    // down for the wrong reason.
    `attached=$$(mc admin policy entities podokit --user "$$S3_ACCESS_KEY_ID")`,
    `case "$$attached" in *podokit-app*) ;; *) echo "policy not attached" >&2; exit 1 ;; esac`,
  ].join("\n");
  return (
    `  ${serviceName(profile, "object-storage-init")}:\n` +
    `    image: ${quote(clientImage)}\n` +
    `    restart: "no"\n` +
    `    depends_on:\n      ${serviceName(profile, "object-storage")}:\n        condition: service_healthy\n` +
    `    env_file:\n      - ${quote(storage.envFile)}\n` +
    `    entrypoint: ["sh", "-c", ${quote(script)}]\n` +
    `    networks: [${profile.target.project}]\n`
  );
}

function applicationService(
  profile: DockerComposeProfileV1,
  role: "api" | "web" | "worker",
  image: string,
  release: string,
  stateDigest: string,
  environment: Record<string, string>,
  options: { command?: string; healthcheckPath?: string },
): string {
  const workload = role === "worker" ? profile.workloads.worker : profile.workloads[role];
  if (!workload) return "";
  const envFile = role === "web" ? profile.secrets.web : profile.secrets.api;
  // Service name -> the condition it must reach before this one starts.
  const dependsOn: Array<[string, string]> = [];
  if (profile.dependencies.postgres.mode === "managed" && role !== "web") {
    dependsOn.push([serviceName(profile, "postgres"), "service_healthy"]);
  }
  if (profile.dependencies.redis.mode === "managed" && role !== "web") {
    dependsOn.push([serviceName(profile, "redis"), "service_healthy"]);
  }
  if (profile.dependencies.objectStorage.mode === "managed" && role !== "web") {
    // Not just "storage is up": the bucket and the application user's policy are
    // created by the init service, and an API that starts before that finishes
    // fails every object operation and reports itself unready.
    dependsOn.push([serviceName(profile, "object-storage-init"), "service_completed_successfully"]);
  }
  if (role === "web") dependsOn.push([serviceName(profile, "api"), "service_healthy"]);
  return (
    `  ${serviceName(profile, role)}:\n` +
    `    image: ${quote(image)}\n` +
    `    restart: unless-stopped\n` +
    `    stop_grace_period: ${composeStopGraceSeconds(role, environment)}s\n` +
    (options.command ? `    command: ${options.command}\n` : "") +
    (envFile ? `    env_file:\n      - ${quote(envFile.path)}\n` : "") +
    environmentBlock(environment, "    ") +
    (dependsOn.length
      ? `    depends_on:\n${dependsOn
          .map(([name, condition]) => `      ${name}:\n        condition: ${condition}\n`)
          .join("")}`
      : "") +
    `    networks: [${profile.target.project}]\n` +
    resourceBlock(workload, "    ") +
    (options.healthcheckPath
      ? httpHealthcheck(options.healthcheckPath, "    ")
      : // The worker runs the API image with a different entry point, and that image
        // declares an HTTP healthcheck. A process with no HTTP server can never pass
        // it, so the container reports unhealthy forever unless the inherited check
        // is switched off here.
        "    healthcheck:\n      disable: true\n") +
    labelsBlock(profile, release, stateDigest, "    ")
  );
}

function gatewayService(profile: DockerComposeProfileV1, image: string): string {
  const transparent = composeGatewayIsTransparent(profile);
  // Transparent: trust every peer, so Caddy keeps the forwarded headers it receives
  // and appends its peer to X-Forwarded-For instead of replacing them.
  const globalOptions = transparent
    ? `{
  servers {
    trusted_proxies static 0.0.0.0/0 ::/0
  }
}
`
    : profile.exposure.trustedProxyCidrs.length
    ? `{
  servers {
    trusted_proxies static ${profile.exposure.trustedProxyCidrs.join(" ")}
    trusted_proxies_strict
  }
}
`
    : "";
  const api = `${serviceName(profile, "api")}:${CONTAINER_PORT}`;
  // Caddy appends the peer to X-Forwarded-For, so behind a trusted proxy web and
  // API would get "client, proxy" and record the proxy at one trusted hop. Send
  // the client address Caddy resolved instead: the client behind a trusted proxy,
  // the peer otherwise.
  const reverseProxy = (upstream: string): string =>
    transparent
      ? `    reverse_proxy ${upstream}\n`
      : `    reverse_proxy ${upstream} {\n` +
        `      header_up X-Forwarded-For {client_ip}\n` +
        `    }\n`;
  const webSocketRoutes = profile.exposure.webSocketPaths.length
    ? `  @api_websockets path ${profile.exposure.webSocketPaths.join(" ")}\n` +
      `  handle @api_websockets {\n` +
      reverseProxy(api) +
      `  }\n`
    : "";
  const apiPathRoutes = profile.exposure.apiPaths.length
    ? `  @api_paths path ${profile.exposure.apiPaths
        .map((path) => `${apiPathBase(path)} ${apiPathBase(path)}/*`)
        .join(" ")}\n` +
      `  handle @api_paths {\n` +
      `    uri strip_prefix ${API_PATH_PREFIX}\n` +
      reverseProxy(api) +
      `  }\n`
    : "";
  const caddyfile =
    globalOptions +
    `:3000 {\n` +
    webSocketRoutes +
    apiPathRoutes +
    `  handle {\n` +
    reverseProxy(`${serviceName(profile, "web")}:${CONTAINER_PORT}`) +
    `  }\n` +
    `}\n`;
  const start =
    "printf '%s' \"$${CADDYFILE_CONTENT}\" > /tmp/Caddyfile\n" +
    "exec caddy run --config /tmp/Caddyfile --adapter caddyfile";
  return (
    `  ${serviceName(profile, "gateway")}:\n` +
    `    image: ${quote(image)}\n` +
    `    restart: unless-stopped\n` +
    `    entrypoint: ["sh", "-c", ${quote(start)}]\n` +
    environmentBlock({ CADDYFILE_CONTENT: caddyfile }, "    ") +
    `    depends_on:\n` +
    `      ${serviceName(profile, "api")}:\n        condition: service_healthy\n` +
    `      ${serviceName(profile, "web")}:\n        condition: service_healthy\n` +
    `    ports:\n      - ${quote(
      `${profile.exposure.bindAddress}:${profile.exposure.port}:${CONTAINER_PORT}`,
    )}\n` +
    `    networks: [${profile.target.project}]\n` +
    `    healthcheck:\n` +
    `      test: ["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:2019/config/"]\n` +
    `      interval: 10s\n      timeout: 5s\n      retries: 6\n      start_period: 10s\n` +
    // No release or rollout-state label: the gateway runs none of the release's
    // code, and a label that changes with every release would make Compose
    // recreate it, which closes the published port until the new one starts.
    `    labels:\n      io.podokit.project: ${quote(profile.target.project)}\n`
  );
}

export function renderComposeDocument(
  profile: DockerComposeProfileV1,
  release: string,
  images: ComposeImages,
  stateDigest: string,
  proxyTimeouts: AppProxyTimeouts,
  workerCommand: string[] = ["bun", "dist/main-worker.js"],
): string {
  const environment = derivedRuntimeConfig(profile, proxyTimeouts);
  const services: string[] = [];
  if (profile.dependencies.postgres.mode === "managed" && images.postgres) {
    services.push(postgresService(profile, images.postgres));
  }
  if (profile.dependencies.redis.mode === "managed" && images.redis) {
    services.push(redisService(profile, images.redis));
  }
  if (profile.dependencies.objectStorage.mode === "managed" && images.objectStorage) {
    services.push(objectStorageService(profile, images.objectStorage));
    if (images.objectStorageClient) {
      services.push(objectStorageInitService(profile, images.objectStorageClient));
    }
  }
  services.push(
    applicationService(profile, "api", images.api, release, stateDigest, environment, {
      healthcheckPath: "/health/ready",
    }),
  );
  const webEnvironment = { ...WEB_DNS_CONFIG, ...environment };
  services.push(
    applicationService(profile, "web", images.web, release, stateDigest, webEnvironment, {
      // The web server's own route: an API outage must not mark it unhealthy.
      healthcheckPath: "/healthz",
    }),
  );
  if (!images.gateway) throw new Error("A resolved gateway image is required.");
  services.push(gatewayService(profile, images.gateway));
  if (profile.workloads.worker) {
    // The worker runs the API image with a different entry point, exactly as the
    // Kubernetes driver does.
    services.push(
      applicationService(profile, "worker", images.api, release, stateDigest, environment, {
        command: `[${workerCommand.map((part) => quote(part)).join(", ")}]`,
      }),
    );
  }

  const volumes = [
    ...(profile.dependencies.postgres.mode === "managed"
      ? [profile.dependencies.postgres.volume]
      : []),
    ...(profile.dependencies.redis.mode === "managed" ? [profile.dependencies.redis.volume] : []),
    ...(profile.dependencies.objectStorage.mode === "managed"
      ? [profile.dependencies.objectStorage.volume]
      : []),
  ];

  return (
    `# Generated by PodoKit. Do not edit; run "podo deploy render" to regenerate.\n` +
    `name: ${profile.target.project}\n` +
    `services:\n${services.filter(Boolean).join("")}` +
    (volumes.length
      ? `volumes:\n${volumes.map((name) => `  ${name}:\n    external: true\n`).join("")}`
      : "") +
    `networks:\n  ${profile.target.project}:\n    name: ${profile.target.project}\n`
  );
}

/**
 * The migration runs as its own Compose project so it can be started, waited on,
 * and removed without touching the running application definition.
 */
export function renderMigrationDocument(
  profile: DockerComposeProfileV1,
  release: string,
  images: ComposeImages,
  proxyTimeouts: AppProxyTimeouts,
  defaultCommand: string[] = ["bun", "run", "migrate:all"],
): string {
  const command = profile.migration?.command ?? defaultCommand;
  return (
    `# Generated by PodoKit. One-shot migration for ${release}.\n` +
    `name: ${profile.target.project}-migrate\n` +
    `services:\n` +
    `  migrate:\n` +
    `    image: ${quote(images.api)}\n` +
    `    restart: "no"\n` +
    `    command: [${command.map((part) => quote(part)).join(", ")}]\n` +
    `    env_file:\n      - ${quote(profile.secrets.api.path)}\n` +
    environmentBlock(derivedRuntimeConfig(profile, proxyTimeouts), "    ") +
    `    networks: [${profile.target.project}]\n` +
    `networks:\n  ${profile.target.project}:\n    name: ${profile.target.project}\n    external: true\n`
  );
}

export function defaultComposeImages(
  profile: DockerComposeProfileV1,
  release: string,
): ComposeImages {
  return {
    api: `${profile.release.apiRepository}:${release}`,
    web: `${profile.release.webRepository}:${release}`,
    gateway: profile.exposure.gatewayImage,
    postgres:
      profile.dependencies.postgres.mode === "managed"
        ? profile.dependencies.postgres.image
        : null,
    redis:
      profile.dependencies.redis.mode === "managed" ? profile.dependencies.redis.image : null,
    objectStorage:
      profile.dependencies.objectStorage.mode === "managed"
        ? profile.dependencies.objectStorage.image
        : null,
    objectStorageClient:
      profile.dependencies.objectStorage.mode === "managed"
        ? profile.dependencies.objectStorage.clientImage
        : null,
  };
}

export function renderComposeDeployment(
  projectRoot: string,
  profileName: string,
  profile: DockerComposeProfileV1,
  release: string,
  resolvedImages?: ComposeImages,
  stateDigest?: string,
): ComposeRuntime {
  profilePath(projectRoot, profileName);
  const images = resolvedImages ?? defaultComposeImages(profile, release);
  const proxyTimeouts = readAppProxyTimeouts(projectRoot);
  const effectiveStateDigest = stateDigest ?? rolloutStateDigest(profile, {}, proxyTimeouts);
  const root = join(resolve(projectRoot), ".podokit", "runtime", "deploy", profileName);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const toolchain = readManifest(projectRoot)?.toolchain ?? resolveToolchain();
  const composeDocument = renderComposeDocument(
    profile,
    release,
    images,
    effectiveStateDigest,
    proxyTimeouts,
    toolchainWorkerCommand(toolchain),
  );
  const migrationDocument = renderMigrationDocument(
    profile,
    release,
    images,
    proxyTimeouts,
    toolchainMigrationCommand(toolchain),
  );
  const composeFile = join(root, "compose.yaml");
  const migrationFile = join(root, "compose.migrate.yaml");
  writeFileSync(composeFile, composeDocument);
  writeFileSync(migrationFile, migrationDocument);
  return { root, composeFile, migrationFile, composeDocument, migrationDocument };
}
