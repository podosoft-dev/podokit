import { readAppProxyTimeouts, type AppProxyTimeouts } from "./app-proxy-timeouts";
import type { AnyDeployProfile } from "./deploy-driver";
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

export function profileFindings(projectRoot: string, profile: AnyDeployProfile): DeployFinding[] {
  const modules = installedModules(projectRoot);
  const findings: DeployFinding[] = [idleTimeoutFinding(profile.runtimeConfig, readAppProxyTimeouts(projectRoot))];
  if (modules.has("audit-log")) findings.push(auditLogFinding(profile.runtimeConfig));
  return findings;
}

export function formatFinding(finding: DeployFinding): string {
  return `${finding.ok ? (finding.warning ? "warn" : "ok  ") : "FAIL"} ${finding.message}`;
}
