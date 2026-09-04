import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  isProviderCapability,
  isProviderName,
  PROVIDER_CAPABILITIES,
  PROVIDER_NAMES,
  type ProviderCapability,
  type ProviderSelections,
} from "@podosoft/podokit-runtime";
import { addModule, listModules, readModuleManifest, resolveModule } from "./add";
import {
  computeDrift,
  computeFilesLock,
  filesLockPath,
  manifestPath,
  providerTemplateVars,
  readManifest,
  writeFilesLock,
  writeManifest,
} from "./lockfile";

export const PROVIDERS_SOURCE = "apps/api/src/config/providers.ts";

export interface ProviderListItem {
  capability: ProviderCapability;
  selected: string;
  available: readonly string[];
}

export interface ProviderChangePlan {
  capability: ProviderCapability;
  from: string;
  to: string;
  changed: boolean;
  files: string[];
  modulesToAdd: string[];
  warnings: string[];
}

export interface ApplyProviderChangeOptions {
  modulesDir?: string;
  podokitVersion?: string;
}

function requireManifest(projectRoot: string) {
  const manifest = readManifest(projectRoot);
  if (!manifest) {
    throw new Error("This does not look like a PodoKit project: .podokit/manifest.json not found.");
  }
  return manifest;
}

function assertProvider(capability: string, provider: string): ProviderCapability {
  if (!isProviderCapability(capability)) {
    throw new Error(
      `Unknown provider capability "${capability}". Use one of: ${PROVIDER_CAPABILITIES.join(", ")}.`,
    );
  }
  if (!isProviderName(capability, provider)) {
    throw new Error(
      `Unknown ${capability} provider "${provider}". Use one of: ${PROVIDER_NAMES[capability].join(", ")}.`,
    );
  }
  return capability;
}

export function providerSource(providers: ProviderSelections): string {
  return `import type { ProviderSelections } from "@podosoft/podokit-runtime";\n\n` +
    `export const PROVIDERS = {\n` +
    `  database: "${providers.database}",\n` +
    `  cache: "${providers.cache}",\n` +
    `  "object-storage": "${providers["object-storage"]}",\n` +
    `  events: "${providers.events}",\n` +
    `  jobs: "${providers.jobs}",\n` +
    `} as const satisfies ProviderSelections;\n`;
}

export function listProviders(projectRoot: string): ProviderListItem[] {
  const manifest = requireManifest(projectRoot);
  return PROVIDER_CAPABILITIES.map((capability) => ({
    capability,
    selected: manifest.providers[capability],
    available: PROVIDER_NAMES[capability],
  }));
}

export function planProviderChange(
  projectRoot: string,
  capabilityInput: string,
  provider: string,
  modulesDir?: string,
): ProviderChangePlan {
  const capability = assertProvider(capabilityInput, provider);
  const manifest = requireManifest(projectRoot);
  const from = manifest.providers[capability];
  const changed = from !== provider;
  const sourcePath = join(projectRoot, PROVIDERS_SOURCE);
  const files = changed || !existsSync(sourcePath)
    ? [PROVIDERS_SOURCE, ".podokit/manifest.json", ".podokit/files.lock"]
    : [];
  const implementation = modulesDir
    ? providerImplementationModule(projectRoot, modulesDir, capability, provider)
    : undefined;
  const modulesToAdd = implementation
    && !manifest.modules.some((module) => module.name === implementation)
    ? [implementation]
    : [];
  return {
    capability,
    from,
    to: provider,
    changed,
    files,
    modulesToAdd,
    warnings: [
      ...(changed ? [
          "Provider switching changes configuration and code only.",
          "Existing data and objects are not migrated or deleted.",
        ] : []),
      ...(modulesToAdd.length
        ? [`Provider implementation module ${modulesToAdd[0]} will be added.`]
        : []),
    ],
  };
}

function providerImplementationModule(
  projectRoot: string,
  modulesDir: string,
  capability: ProviderCapability,
  provider: string,
): string | undefined {
  for (const available of listModules(modulesDir, projectRoot)) {
    const resolved = resolveModule(available.name, modulesDir, projectRoot);
    if (!resolved) continue;
    if (readModuleManifest(resolved.dir).provides?.[capability] === provider) {
      return available.name;
    }
  }
  if (capability === "database") return undefined;
  throw new Error(`No module provides the ${capability} provider "${provider}".`);
}

export function applyProviderChange(
  projectRoot: string,
  capabilityInput: string,
  provider: string,
  options: ApplyProviderChangeOptions = {},
): ProviderChangePlan {
  const plan = planProviderChange(projectRoot, capabilityInput, provider, options.modulesDir);
  if (!plan.changed && plan.files.length === 0 && plan.modulesToAdd.length === 0) return plan;

  const drift = computeDrift(projectRoot);
  if (drift.drifted.includes(PROVIDERS_SOURCE) || drift.missing.includes(PROVIDERS_SOURCE)) {
    throw new Error(
      `${PROVIDERS_SOURCE} has local edits. Resolve them or run podo eject before changing providers.`,
    );
  }

  for (const module of plan.modulesToAdd) {
    if (!options.modulesDir) throw new Error("A modules directory is required to add provider implementations.");
    addModule({
      projectRoot,
      module,
      modulesDir: options.modulesDir,
      podokitVersion: options.podokitVersion,
    });
  }

  const manifest = requireManifest(projectRoot);
  const sourcePath = join(projectRoot, PROVIDERS_SOURCE);
  const manifestFile = manifestPath(projectRoot);
  const lockFile = filesLockPath(projectRoot);
  const snapshots = new Map<string, string | null>([
    [sourcePath, existsSync(sourcePath) ? readFileSync(sourcePath, "utf8") : null],
    [manifestFile, readFileSync(manifestFile, "utf8")],
    [lockFile, existsSync(lockFile) ? readFileSync(lockFile, "utf8") : null],
  ]);
  const temporary = `${sourcePath}.podokit-provider-${process.pid}`;

  try {
    manifest.providers[plan.capability] = plan.to as never;
    manifest.answers = { ...manifest.answers, ...providerTemplateVars(manifest.providers) };
    writeFileSync(temporary, providerSource(manifest.providers), { mode: 0o600 });
    renameSync(temporary, sourcePath);
    writeManifest(projectRoot, manifest);
    writeFilesLock(
      projectRoot,
      computeFilesLock(projectRoot, manifest.ownedGlobs, manifest.managedOverrides ?? []),
    );
  } catch (error) {
    rmSync(temporary, { force: true });
    for (const [path, content] of snapshots) {
      if (content === null) rmSync(path, { force: true });
      else writeFileSync(path, content);
    }
    throw error;
  }
  return plan;
}
