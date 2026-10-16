import { readAppProxyTimeouts, type AppProxyTimeouts } from "./app-proxy-timeouts";
import { composeHasGateway } from "./deploy-compose-profile";
import { composeProxyTrust } from "./deploy-compose-render";
import type { AnyDeployProfile } from "./deploy-driver";
import { kubernetesProxyTrust } from "./deploy-render";
import {
  IDLE_TIMEOUT_KEYS,
  MAX_IDLE_TIMEOUT_SECONDS,
  describeProxyWait,
  idleTimeoutConfig,
  idleTimeoutCovers,
  longestProxyWait,
} from "./deploy-schema";
import { readManifest } from "./lockfile";

/**
 * Read-only checks of a deployment profile against the application it deploys.
 *
 * Both drivers run them before they look at the target, because they need
 * nothing but the project directory: a profile that misconfigures the
 * application fails or warns the same way on a cluster and on a Docker host.
 */

/** One doctor result. A warning still passes, so apply runs, but the CLI flags it. */
export interface DeployFinding {
  code: string;
  ok: boolean;
  message: string;
  warning?: true;
}

export function installedModules(projectRoot: string): Set<string> {
  return new Set((readManifest(projectRoot)?.modules ?? []).map((module) => module.name));
}

function auditLogFinding(runtimeConfig: Record<string, string>): DeployFinding {
  const value = runtimeConfig.AUDIT_LOG_ENABLED;
  if (value === "true") {
    return {
      code: "audit-log",
      ok: true,
      message: "AUDIT_LOG_ENABLED is true, so the audit log records from the first request.",
    };
  }
  return {
    code: "audit-log",
    ok: true,
    warning: true,
    message:
      value === undefined
        ? 'runtimeConfig does not set AUDIT_LOG_ENABLED, so until an administrator saves the audit setting the API\'s built-in default decides whether anything is recorded; set it to "true".'
        : `AUDIT_LOG_ENABLED is ${JSON.stringify(value)}, so the audit log records nothing until an administrator turns it on in Settings; set it to "true".`,
  };
}

/**
 * Whether the rendered idle timeouts outlast the /api proxy's longest wait. A web
 * server whose CONNECTION_IDLE_TIMEOUT cannot refuses to start, so that fails; a
 * short API_IDLE_TIMEOUT only warns, because the API may lift its idle timeout
 * for the long routes itself with `server.timeout(request, 0)`.
 */
function idleTimeoutFinding(
  runtimeConfig: Record<string, string>,
  proxyTimeouts: AppProxyTimeouts,
): DeployFinding {
  const code = "idle-timeouts";
  const explicit = IDLE_TIMEOUT_KEYS.filter((key) => runtimeConfig[key] !== undefined);
  if ("error" in proxyTimeouts) {
    return explicit.length === IDLE_TIMEOUT_KEYS.length
      ? { code, ok: true, warning: true, message: `${proxyTimeouts.error} The idle timeouts were not checked.` }
      : { code, ok: false, message: proxyTimeouts.error };
  }
  let rendered: Record<string, string>;
  try {
    rendered = idleTimeoutConfig(runtimeConfig, proxyTimeouts);
  } catch (error) {
    return { code, ok: false, message: (error as Error).message };
  }
  const wait = longestProxyWait(runtimeConfig, proxyTimeouts.entries);
  const problems: Array<{ key: string; blocking: boolean; message: string }> = [];
  for (const key of explicit) {
    const value = rendered[key]!;
    const seconds = Number(value);
    if (!/^\d+$/.test(value) || seconds > MAX_IDLE_TIMEOUT_SECONDS) {
      problems.push({ key, blocking: true, message: `${key} "${value}" is not 0 to ${MAX_IDLE_TIMEOUT_SECONDS} seconds.` });
    } else if (!idleTimeoutCovers(seconds, wait)) {
      problems.push({
        key,
        blocking: key === "CONNECTION_IDLE_TIMEOUT",
        message:
          key === "CONNECTION_IDLE_TIMEOUT"
            ? `CONNECTION_IDLE_TIMEOUT "${value}" closes a silent connection before the /api proxy's longest wait (${describeProxyWait(wait)}), so the web server refuses to start; remove it from runtimeConfig to derive it.`
            : `API_IDLE_TIMEOUT "${value}" closes a silent connection before the /api proxy's longest wait (${describeProxyWait(wait)}), unless the API lifts it for that route; remove it from runtimeConfig to derive it.`,
      });
    }
  }
  if (problems.length) {
    const blocking = problems.some((problem) => problem.blocking);
    return {
      code,
      ok: !blocking,
      ...(blocking ? {} : { warning: true as const }),
      message: problems.map((problem) => problem.message).join(" "),
    };
  }
  return {
    code,
    ok: true,
    message:
      `CONNECTION_IDLE_TIMEOUT ${rendered.CONNECTION_IDLE_TIMEOUT} and API_IDLE_TIMEOUT ${rendered.API_IDLE_TIMEOUT} ` +
      `outlast the /api proxy's longest wait (${describeProxyWait(wait)}).`,
  };
}

/** PostgreSQL's default max_connections, which a profile can change. */
export const DEFAULT_MAX_CONNECTIONS = 100;
/** PostgreSQL's default superuser_reserved_connections, unavailable to the application. */
const RESERVED_CONNECTIONS = 3;
/** The migration process: Better Auth's schema check, then the application migrations. */
const MIGRATION_CONNECTIONS = 2;

export interface ConnectionBudget {
  maxConnections: number;
  available: number;
  /** Connections one API or worker process can hold, and what they are. */
  perProcess: number;
  perProcessTerms: string[];
  steadyProcesses: number;
  steady: number;
  /** Processes and connections while a rollout runs old and new pods side by side. */
  rolloutProcesses: number;
  rollout: number;
  migration: number;
  peak: number;
}

function poolSize(runtimeConfig: Record<string, string>, key: string, fallback: number): number {
  const value = runtimeConfig[key];
  if (value === undefined) return fallback;
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`${key} "${value}" is not a positive integer.`);
  return Number(value);
}

/**
 * The most PostgreSQL connections the deployment can open: every API and worker
 * process with each pool full, the Kubernetes rollout's surge pod per workload
 * (the rendered strategy allows one), and the migration that runs beside the
 * release still serving. Compose replaces containers without a surge. Null when
 * the deployment uses no PostgreSQL.
 */
export function connectionBudget(profile: AnyDeployProfile, modules: Set<string>): ConnectionBudget | null {
  const postgres = profile.dependencies.postgres;
  if (postgres.mode === "disabled") return null;
  const config = profile.runtimeConfig;
  const queryPool = poolSize(config, "DB_POOL_MAX", 20);
  // The Bun SQL pool opens one more connection to check a server that stopped answering.
  const perProcessTerms = [`DB_POOL_MAX ${queryPool} + 1`];
  let perProcess = queryPool + 1;
  if (modules.has("auth")) {
    const authPool = poolSize(config, "DB_AUTH_POOL_MAX", 10);
    perProcessTerms.push(`DB_AUTH_POOL_MAX ${authPool}`);
    perProcess += authPool;
  }
  for (const pool of postgres.appPools ?? []) {
    const size = poolSize(config, pool.sizeKey, 0);
    perProcessTerms.push(`${pool.sizeKey} ${size}${pool.extraConnections ? ` + ${pool.extraConnections}` : ""}`);
    perProcess += size + pool.extraConnections;
  }
  const worker = profile.workloads.worker;
  const steadyProcesses = profile.workloads.api.replicas + (worker?.replicas ?? 0);
  const rolloutProcesses = steadyProcesses + (profile.driver === "kubernetes-helm" ? 1 + (worker ? 1 : 0) : 0);
  const maxConnections = postgres.maxConnections ?? DEFAULT_MAX_CONNECTIONS;
  const steady = steadyProcesses * perProcess;
  const rollout = rolloutProcesses * perProcess;
  return {
    maxConnections,
    available: maxConnections - RESERVED_CONNECTIONS,
    perProcess,
    perProcessTerms,
    steadyProcesses,
    steady,
    rolloutProcesses,
    rollout,
    migration: MIGRATION_CONNECTIONS,
    peak: Math.max(rollout, steady + MIGRATION_CONNECTIONS),
  };
}

function budgetSummary(budget: ConnectionBudget): string {
  return (
    `each API or worker process holds up to ${budget.perProcess} (${budget.perProcessTerms.join(" + ")}); ` +
    `${budget.steadyProcesses} process(es) hold ${budget.steady}` +
    (budget.rolloutProcesses > budget.steadyProcesses
      ? `, ${budget.rolloutProcesses} during a rollout hold ${budget.rollout}`
      : "") +
    `, and the migration adds ${budget.migration} to the ${budget.steady}`
  );
}

const BUDGET_FIX =
  "Lower DB_POOL_MAX or DB_AUTH_POOL_MAX in runtimeConfig, run fewer replicas, or raise dependencies.postgres.maxConnections.";

/** The plan warning for a budget over the limit, or null. */
export function connectionBudgetWarning(profile: AnyDeployProfile, modules: Set<string>): string | null {
  let budget: ConnectionBudget | null;
  try {
    budget = connectionBudget(profile, modules);
  } catch (error) {
    return `Cannot count PostgreSQL connections: ${(error as Error).message}`;
  }
  if (!budget || budget.peak <= budget.available) return null;
  return (
    `PostgreSQL connections can reach ${budget.peak}, above the ${budget.available} that max_connections ` +
    `${budget.maxConnections} leaves after ${RESERVED_CONNECTIONS} reserved: ${budgetSummary(budget)}. ${BUDGET_FIX}`
  );
}

function connectionBudgetFinding(profile: AnyDeployProfile, modules: Set<string>): DeployFinding | null {
  const code = "database-connections";
  let budget: ConnectionBudget | null;
  try {
    budget = connectionBudget(profile, modules);
  } catch (error) {
    return { code, ok: false, message: `Cannot count PostgreSQL connections: ${(error as Error).message}` };
  }
  if (!budget) return null;
  const limit = `max_connections ${budget.maxConnections} leaves ${budget.available} after ${RESERVED_CONNECTIONS} reserved`;
  if (budget.steady > budget.available) {
    return {
      code,
      ok: false,
      message: `PostgreSQL connections exceed the limit even between rollouts: ${limit}, and ${budgetSummary(budget)}. ${BUDGET_FIX}`,
    };
  }
  if (budget.peak > budget.available) {
    return {
      code,
      ok: true,
      warning: true,
      message: `PostgreSQL connections can reach ${budget.peak} during a deployment: ${limit}, and ${budgetSummary(budget)}. ${BUDGET_FIX}`,
    };
  }
  return {
    code,
    ok: true,
    message: `PostgreSQL connections stay within the limit, at most ${budget.peak}: ${limit}, and ${budgetSummary(budget)}.`,
  };
}

/**
 * Whether the trusted chain the profile describes matches the topology PodoKit
 * renders, so web and API record the client rather than a proxy in front.
 */
function clientAddressFinding(profile: AnyDeployProfile): DeployFinding {
  const code = "client-address";
  const edge = profile.exposure.edgeProxies;
  const problems: string[] = [];
  let rendered: Record<string, string>;
  if (profile.driver === "docker-compose") {
    rendered = composeProxyTrust(profile);
    const cidrs = profile.exposure.trustedProxyCidrs;
    if (composeHasGateway(profile) && edge > 0 && cidrs.length === 0) {
      problems.push(
        `exposure.edgeProxies is ${edge} but exposure.trustedProxyCidrs is empty, so the gateway sends the ` +
          "nearest edge proxy's address as every request's client; list that proxy's CIDR.",
      );
    } else if (composeHasGateway(profile) && edge === 0 && cidrs.length > 0) {
      problems.push(
        "exposure.trustedProxyCidrs trusts forwarded headers from a proxy, but exposure.edgeProxies is 0; " +
          "set it to the number of proxies in front of the published port.",
      );
    }
  } else {
    rendered = kubernetesProxyTrust(profile);
    const direct = [...profile.exposure.webSocketPaths, ...profile.exposure.apiPaths];
    if (profile.exposure.mode === "ingress" && edge > 0 && direct.length > 0) {
      problems.push(
        `With exposure.edgeProxies ${edge}, the Ingress forwards ${edge + 1} addresses on ${direct.join(", ")}, ` +
          "where requests skip the web server, and the API, which trusts the one address the web server sends, " +
          "records the nearest edge proxy for them. Pass the client address to the Ingress controller with " +
          "the PROXY protocol instead, so the controller sees the client as its peer, and set edgeProxies to 0.",
      );
    }
  }
  const depth = rendered.XFF_DEPTH;
  const defaultOrigin = "keeps its default origin, https and the Host header,";
  const web = !depth
    ? `trusts no forwarded header: it ${defaultOrigin} and takes the client address from the connection`
    : `${rendered.PROTOCOL_HEADER ? "takes its origin from X-Forwarded-Proto and X-Forwarded-Host" : defaultOrigin} ` +
      `and takes the client from the X-Forwarded-For entry ${depth === "1" ? "its peer wrote" : `${depth} hops away`} ` +
      `(XFF_DEPTH ${depth})`;
  const summary = `the web server ${web}, and the API trusts the one address the web server sends (TRUSTED_PROXY_HOPS 1)`;
  if (problems.length) return { code, ok: true, warning: true, message: `${problems.join(" ")} Rendered: ${summary}.` };
  const traefik =
    profile.driver === "kubernetes-helm" && profile.exposure.mode === "ingress" && edge > 0
      ? " The Ingress controller must trust the edge proxies' forwarded headers, such as Traefik's forwardedHeaders.trustedIPs."
      : "";
  return { code, ok: true, message: `With exposure.edgeProxies ${edge}, ${summary}.${traefik}` };
}

export function profileFindings(projectRoot: string, profile: AnyDeployProfile): DeployFinding[] {
  const modules = installedModules(projectRoot);
  const findings: DeployFinding[] = [
    clientAddressFinding(profile),
    idleTimeoutFinding(profile.runtimeConfig, readAppProxyTimeouts(projectRoot)),
  ];
  const budget = connectionBudgetFinding(profile, modules);
  if (budget) findings.push(budget);
  if (modules.has("audit-log")) findings.push(auditLogFinding(profile.runtimeConfig));
  return findings;
}

export function formatFinding(finding: DeployFinding): string {
  return `${finding.ok ? (finding.warning ? "warn" : "ok  ") : "FAIL"} ${finding.message}`;
}
