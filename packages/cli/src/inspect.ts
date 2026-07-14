import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { computeDrift, readFilesLock, readManifest, type Tier } from "./lockfile";

/**
 * Read-only project inspection for `podo status`, `podo diff`, and
 * `podo doctor`. None of these write to disk.
 */

export interface StatusReport {
  podokitVersion: string;
  template: string;
  packageManager: string;
  modules: string[];
  moduleDetails: { name: string; packageName?: string; version?: string }[];
  tiers: Record<Tier, number>;
  drifted: string[];
  missing: string[];
}

export class NotAProjectError extends Error {
  constructor() {
    super("No .podokit/manifest.json found. Run inside a project created by `podo create`.");
    this.name = "NotAProjectError";
  }
}

export function status(projectRoot: string): StatusReport {
  const manifest = readManifest(projectRoot);
  const lock = readFilesLock(projectRoot);
  if (!manifest || !lock) throw new NotAProjectError();
  const tiers: Record<Tier, number> = { managed: 0, assembled: 0, owned: 0 };
  for (const entry of Object.values(lock.files)) tiers[entry.tier] += 1;
  const { drifted, missing } = computeDrift(projectRoot);
  return {
    podokitVersion: manifest.podokitVersion,
    template: manifest.template,
    packageManager: manifest.packageManager,
    modules: manifest.modules.map((m) => m.name),
    moduleDetails: manifest.modules.map((m) => ({
      name: m.name,
      packageName: m.packageName,
      version: m.moduleVersion,
    })),
    tiers,
    drifted,
    missing,
  };
}

/** Managed/assembled files the user has edited or deleted since generation. */
export function diff(projectRoot: string): { drifted: string[]; missing: string[] } {
  if (!readManifest(projectRoot)) throw new NotAProjectError();
  return computeDrift(projectRoot);
}

/** Framework version-compatibility check. See ADR-0008 (4-layer defense). */
export interface DoctorFinding {
  package: string;
  installed: string;
  supported: string;
  ok: boolean;
}

/**
 * Known-good framework ranges for the current PodoKit line. A generated app may
 * bump these itself; doctor warns when it moves outside the supported range so
 * `@podosoft/*` extensions still match.
 */
export const SUPPORTED_FRAMEWORKS: Record<string, { app: "api" | "web"; range: string; majors: number[] }> = {
  "@nestjs/core": { app: "api", range: "^11", majors: [11] },
  "better-auth": { app: "api", range: ">=1.6.23 <1.7", majors: [1] },
  svelte: { app: "web", range: "^5", majors: [5] },
};

function declaredVersion(projectRoot: string, app: "api" | "web", pkg: string): string | null {
  const file = join(projectRoot, "apps", app, "package.json");
  if (!existsSync(file)) return null;
  const json = JSON.parse(readFileSync(file, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return json.dependencies?.[pkg] ?? json.devDependencies?.[pkg] ?? null;
}

/** Parse the leading major from a semver range like `^11.1.0` or `>=1.6.23 <1.7`. */
export function leadingMajor(range: string): number | null {
  const match = range.match(/(\d+)\./);
  return match ? Number(match[1]) : null;
}

export function doctor(projectRoot: string): DoctorFinding[] {
  if (!readManifest(projectRoot)) throw new NotAProjectError();
  const findings: DoctorFinding[] = [];
  for (const [pkg, spec] of Object.entries(SUPPORTED_FRAMEWORKS)) {
    const installed = declaredVersion(projectRoot, spec.app, pkg);
    if (installed === null) continue; // package not in this app
    const major = leadingMajor(installed);
    findings.push({
      package: pkg,
      installed,
      supported: spec.range,
      ok: major !== null && spec.majors.includes(major),
    });
  }
  return findings;
}
