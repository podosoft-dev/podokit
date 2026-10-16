import type { AnyDeployProfile } from "./deploy-driver";
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

export function profileFindings(projectRoot: string, profile: AnyDeployProfile): DeployFinding[] {
  const modules = installedModules(projectRoot);
  const findings: DeployFinding[] = [];
  if (modules.has("audit-log")) findings.push(auditLogFinding(profile.runtimeConfig));
  return findings;
}

export function formatFinding(finding: DeployFinding): string {
  return `${finding.ok ? (finding.warning ? "warn" : "ok  ") : "FAIL"} ${finding.message}`;
}
