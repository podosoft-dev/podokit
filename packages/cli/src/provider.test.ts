import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PROVIDER_CAPABILITIES, PROVIDER_NAMES } from "@podosoft/podokit-runtime";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { create } from "./create";
import { readFilesLock, readManifest } from "./lockfile";
import {
  applyProviderChange,
  listProviders,
  planProviderChange,
  providerSource,
  PROVIDERS_SOURCE,
} from "./provider";

const REPO_TEMPLATES = resolve(process.cwd(), "..", "..", "templates");
const RUNTIME_CONTRACTS = resolve(process.cwd(), "..", "runtime", "src", "contracts.ts");

/**
 * Type-checks the selection test every provider module makes, such as
 * `PROVIDERS.cache !== "memory"`, against the project's providers source.
 */
function providerCheckErrors(root: string): string[] {
  const checks = join(root, "apps/api/src/config/provider-checks.ts");
  writeFileSync(
    checks,
    `import { PROVIDERS } from "./providers";\n` +
      PROVIDER_CAPABILITIES.flatMap((capability) =>
        PROVIDER_NAMES[capability].map(
          (name) => `if (PROVIDERS[${JSON.stringify(capability)}] !== ${JSON.stringify(name)}) void 0;\n`,
        )
      ).join(""),
  );
  const program = ts.createProgram([checks], {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    paths: { "@podosoft/podokit-runtime": [RUNTIME_CONTRACTS] },
    types: [],
  });
  const source = program.getSourceFile(checks);
  rmSync(checks);
  return [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)].map(
    (diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
  );
}
const created: string[] = [];

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "podokit-provider-"));
  created.push(root);
  const target = join(root, "app");
  create({ name: "app", templatesDir: REPO_TEMPLATES, targetDir: target });
  return target;
}

afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("provider configuration", () => {
  it("lists every capability and previews without writing", () => {
    const root = project();
    expect(listProviders(root)).toHaveLength(5);
    const before = readFileSync(join(root, PROVIDERS_SOURCE), "utf8");
    const plan = planProviderChange(root, "cache", "memory");
    expect(plan).toMatchObject({ capability: "cache", from: "redis", to: "memory", changed: true });
    expect(plan.warnings).toContain("Existing data and objects are not migrated or deleted.");
    expect(readFileSync(join(root, PROVIDERS_SOURCE), "utf8")).toBe(before);
    expect(readManifest(root)?.providers.cache).toBe("redis");
  });

  it("plans and installs the selected provider implementation module", () => {
    const root = project();
    const modulesDir = join(REPO_TEMPLATES, "modules");
    const plan = planProviderChange(root, "cache", "memory", modulesDir);
    expect(plan.modulesToAdd).toEqual(["cache-memory"]);
    applyProviderChange(root, "cache", "memory", { modulesDir });
    expect(readManifest(root)?.modules.map((module) => module.name)).toContain("cache-memory");
    expect(existsSync(join(root, "apps/api/src/cache-memory/cache-memory.module.ts"))).toBe(true);
  });

  it("keeps every installed provider module type-correct through each switch and back", () => {
    const root = project();
    const modulesDir = join(REPO_TEMPLATES, "modules");
    const initial = readManifest(root)?.providers;
    if (!initial) throw new Error("expected a manifest");
    // The template and the switch write the same source.
    expect(readFileSync(join(root, PROVIDERS_SOURCE), "utf8")).toBe(providerSource(initial));
    expect(providerCheckErrors(root)).toEqual([]);

    for (const capability of PROVIDER_CAPABILITIES) {
      const other = PROVIDER_NAMES[capability].find((name) => name !== initial[capability]);
      if (!other) throw new Error(`expected a second ${capability} provider`);
      for (const provider of [other, initial[capability]]) {
        applyProviderChange(root, capability, provider, { modulesDir });
        const providers = readManifest(root)?.providers;
        expect(providers?.[capability]).toBe(provider);
        expect(readFileSync(join(root, PROVIDERS_SOURCE), "utf8")).toBe(providerSource(providers ?? initial));
        expect(providerCheckErrors(root), `${capability} -> ${provider}`).toEqual([]);
      }
    }
    // The previous implementations stay installed, inactive, for a rollback.
    expect(readManifest(root)?.modules.map((module) => module.name)).toEqual(
      expect.arrayContaining([
        "redis",
        "cache-memory",
        "object-storage-s3",
        "object-storage-local",
        "events-redis",
        "events-memory",
        "bullmq",
        "jobs-local",
      ]),
    );
  });

  it("applies source, manifest, and lockfile as one configuration change", () => {
    const root = project();
    applyProviderChange(root, "cache", "memory");
    expect(readManifest(root)?.providers.cache).toBe("memory");
    expect(readFileSync(join(root, PROVIDERS_SOURCE), "utf8")).toContain('cache: "memory"');
    expect(readFilesLock(root)?.files[PROVIDERS_SOURCE]?.tier).toBe("managed");
    expect(readManifest(root)?.answers.cacheProvider).toBe("memory");
  });

  it("rejects unknown selections and locally edited provider source", () => {
    const root = project();
    expect(() => planProviderChange(root, "database", "mysql")).toThrow(
      "Unknown database provider",
    );
    const source = join(root, PROVIDERS_SOURCE);
    writeFileSync(source, `${readFileSync(source, "utf8")}\n// local edit\n`);
    expect(() => applyProviderChange(root, "cache", "memory", {
      modulesDir: join(REPO_TEMPLATES, "modules"),
    })).toThrow("has local edits");
    expect(readManifest(root)?.providers.cache).toBe("redis");
    expect(readManifest(root)?.modules.map((module) => module.name)).not.toContain("cache-memory");
    expect(existsSync(join(root, "apps/api/src/cache-memory"))).toBe(false);
  });

  it("creates the managed provider source for an existing schema v3 project", () => {
    const root = project();
    const manifestPath = join(root, ".podokit/manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      schemaVersion: number;
      providers?: unknown;
    };
    manifest.schemaVersion = 3;
    delete manifest.providers;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const lockPath = join(root, ".podokit/files.lock");
    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as {
      files: Record<string, unknown>;
    };
    delete lock.files[PROVIDERS_SOURCE];
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    rmSync(join(root, PROVIDERS_SOURCE));
    applyProviderChange(root, "events", "memory");
    expect(existsSync(join(root, PROVIDERS_SOURCE))).toBe(true);
    expect(readManifest(root)?.providers.events).toBe("memory");
  });
});
