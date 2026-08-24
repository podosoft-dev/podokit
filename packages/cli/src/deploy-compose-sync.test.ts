import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CommandRunner } from "./dev";
import { initializeComposeProfile, parseComposeProfile } from "./deploy-compose-profile";
import { getComposeStatus, inspectComposeEndpointFingerprint } from "./deploy-compose";
import {
  composeSyncArtifacts,
  excludesWithin,
  planComposeSync,
  readComposeSyncDrift,
  revertComposeSync,
  runtimeDependenciesOf,
  syncComposeDeployment,
} from "./deploy-compose-sync";
import { profilePath } from "./deploy-schema";
import { initLockfile } from "./lockfile";

const created: string[] = [];

interface Recorded {
  lines: string[];
  runner: CommandRunner;
}

/**
 * A target with one running container per service.
 *
 * `overrides` matches on a substring of the whole command line, which is how the
 * assertions below pin down the exact argv the driver builds rather than trusting a
 * summary of it.
 */
function recordingRunner(overrides: Record<string, string> = {}): Recorded {
  const lines: string[] = [];
  const runner: CommandRunner = (command, args) => {
    const line = `${command} ${args.join(" ")}`;
    lines.push(line);
    const reply = (stdout: string, status = 0) => ({ status, stdout, stderr: "" });
    for (const [needle, stdout] of Object.entries(overrides)) {
      if (line.includes(needle)) {
        return stdout.startsWith("!") ? reply(stdout.slice(1), 1) : reply(stdout);
      }
    }
    if (line.includes("context inspect")) {
      // Two callers, two formats: the fingerprint reads the whole document, and the
      // ssh-destination check reads just the endpoint host.
      return reply(
        line.includes("{{.Endpoints.docker.Host}}")
          ? "ssh://podo@localhost\n"
          : JSON.stringify({
              Name: "production",
              Endpoints: { docker: { Host: "ssh://podo@localhost" } },
            }),
      );
    }
    if (line.includes("info --format")) return reply("DAEMONID\n");
    if (line.includes("deploy.lock")) return reply("");
    if (line.includes("ps --filter")) {
      const service = /com\.docker\.compose\.service=([^ ]+)/.exec(line)?.[1] ?? "unknown";
      return reply(`example-app-${service.split("-").pop() ?? ""}-1\n`);
    }
    if (line.includes("inspect") && line.includes("{{json .}}")) {
      return reply(
        JSON.stringify({
          Config: { User: "100:101" },
          State: { Status: "running", Health: { Status: "healthy" } },
        }),
      );
    }
    if (line.includes("cat /app/") && line.includes("package.json")) {
      return reply(JSON.stringify({ dependencies: { zod: "3.23.8" }, devDependencies: {} }));
    }
    // No marker unless a test puts one there: reading it is how drift is detected,
    // and a container that was never synced has no such file.
    if (line.includes("cat /app/.podokit-sync.json")) return reply("", 1);
    return reply("");
  };
  return { lines, runner };
}

/** A release ledger with one applied entry, as a deployed target would hold. */
function ledger(release: string): string {
  const image = (repo: string): string => `${repo}:${release}@sha256:${"1".repeat(64)}`;
  return JSON.stringify({
    schemaVersion: 1,
    entries: [
      {
        revision: 1,
        release,
        images: {
          api: image("ghcr.io/example/example-app-api"),
          web: image("ghcr.io/example/example-app-web"),
          postgres: "postgres:16.10-alpine",
          redis: null,
          objectStorage: null,
          objectStorageClient: null,
        },
        composeDocumentDigest: `sha256:${"2".repeat(64)}`,
        rolloutStateDigest: `sha256:${"3".repeat(64)}`,
      },
    ],
  });
}

/** A generated project with build output on disk, as a developer would have it. */
function project(options: { packages?: string[]; worker?: boolean } = {}): string {
  // Deliberately not "podokit-sync-": the staging directories the driver creates use
  // that prefix, and a test that recognises staging by prefix would match the project
  // itself and assert against the wrong copy.
  const root = mkdtempSync(join(tmpdir(), "podokit-project-"));
  created.push(root);
  initLockfile(root, {
    template: "fullstack",
    answers: { projectName: "example-app" },
    version: "0.16.4",
  });
  const manifestPath = join(root, ".podokit", "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    modules: Array<{ name: string; addedWith: string }>;
  };
  manifest.modules = [{ name: "auth", addedWith: "0.16.4" }];
  if (options.worker) manifest.modules.push({ name: "bullmq", addedWith: "0.16.4" });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const file = (relative: string, body: string): void => {
    const target = join(root, relative);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, body);
  };
  const appManifest = JSON.stringify({ dependencies: { zod: "3.23.8" }, devDependencies: {} });
  file("apps/api/package.json", appManifest);
  file("apps/web/package.json", appManifest);
  file("apps/api/dist/main.js", "compiled api\n");
  file("apps/web/build/index.js", "compiled web\n");
  file("apps/web/build/client/app.js", "client chunk\n");
  file("apps/web/build/client/agent/1.0.0/binary", "a binary this machine cannot rebuild\n");
  file("apps/web/server.js", "entry\n");
  file("apps/web/src/lib/server/upgrade.js", "upgrade proxy\n");
  for (const name of options.packages ?? []) {
    file(`packages/${name}/package.json`, appManifest);
    file(`packages/${name}/dist/index.js`, "compiled package\n");
  }
  return root;
}

function initialized(options: { packages?: string[]; worker?: boolean; exclude?: string[] } = {}): string {
  const root = project(options);
  initializeComposeProfile(root, "production", {
    context: "production",
    endpointFingerprint: inspectComposeEndpointFingerprint("production", recordingRunner().runner),
    host: "app.example.com",
  });
  if (options.exclude) {
    const path = profilePath(root, "production");
    const document = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    document.sync = { exclude: options.exclude };
    writeFileSync(path, `${JSON.stringify(parseComposeProfile(document), null, 2)}\n`);
  }
  return root;
}

afterEach(() => {
  for (const directory of created.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("sync payload", () => {
  it("mirrors what the images copy in, and nothing else", () => {
    const artifacts = composeSyncArtifacts(project({ packages: ["core"] }));
    expect(artifacts.map((artifact) => artifact.source)).toEqual([
      "packages/core/dist",
      "apps/api/dist",
      "apps/web/build",
      "apps/web/server.js",
      "apps/web/src/lib/server",
    ]);
    // node_modules is production-only, workspace-scoped and platform-specific in the
    // image. Copying a developer's tree over it is the one thing that must not happen.
    expect(artifacts.some((artifact) => artifact.source.includes("node_modules"))).toBe(false);
  });

  it("sends the API build to the worker as well, and the web build to neither", () => {
    const artifacts = composeSyncArtifacts(project());
    const api = artifacts.find((artifact) => artifact.source === "apps/api/dist");
    const web = artifacts.find((artifact) => artifact.source === "apps/web/build");
    expect(api?.roles).toEqual(["api", "worker"]);
    expect(web?.roles).toEqual(["web"]);
  });

  it("omits artifacts the project has not built", () => {
    const root = project();
    rmSync(join(root, "apps", "web", "build"), { recursive: true });
    expect(composeSyncArtifacts(root).map((a) => a.source)).not.toContain("apps/web/build");
  });

  it("resolves an exclude to a path inside the artifact that contains it", () => {
    const artifact = {
      source: "apps/web/build",
      destination: "/app/apps/web/build",
      kind: "directory" as const,
      roles: ["web" as const],
    };
    expect(excludesWithin(artifact, ["apps/web/build/client/agent"])).toEqual(["client/agent"]);
    expect(excludesWithin(artifact, ["apps/api/dist/seed"])).toEqual([]);
  });
});

describe("dependency drift guard", () => {
  it("ignores what the image never installed", () => {
    const runtime = runtimeDependenciesOf({ dependencies: { zod: "3.23.8" } });
    const withDev = runtimeDependenciesOf({
      dependencies: { zod: "3.23.8" },
      ...({ devDependencies: { vitest: "4.0.0" } } as Record<string, unknown>),
    });
    expect(withDev).toBe(runtime);
  });

  it("refuses the sync when a runtime dependency changed", async () => {
    const root = initialized();
    const { runner } = recordingRunner({
      // The container was built before the dependency was added.
      "cat /app/apps/api/package.json": JSON.stringify({ dependencies: {} }),
    });
    await expect(syncComposeDeployment(root, "production", {}, runner)).rejects.toThrow(
      /Runtime dependencies have changed/,
    );
  });

  it("proceeds when only the version and devDependencies moved", async () => {
    const root = initialized();
    const { runner } = recordingRunner({
      "package.json": JSON.stringify({
        version: "9.9.9",
        dependencies: { zod: "3.23.8" },
        devDependencies: { vitest: "4.0.0" },
      }),
    });
    await expect(syncComposeDeployment(root, "production", {}, runner)).resolves.toBeDefined();
  });
});

describe("sync", () => {
  it("finds containers by Compose label rather than by reconstructing their name", () => {
    const { lines, runner } = recordingRunner();
    planComposeSync(initialized(), "production", runner);
    expect(
      lines.some((line) =>
        line.includes("ps --filter label=com.docker.compose.project=example-app --filter label=com.docker.compose.service=example-app-web"),
      ),
    ).toBe(true);
  });

  it("says restarting drops connections and that it does not migrate", () => {
    const { runner } = recordingRunner();
    const plan = planComposeSync(initialized(), "production", runner);
    expect(plan.warnings.join(" ")).toMatch(/drops every connection/);
    expect(plan.warnings.join(" ")).toMatch(/does not run migrations/);
  });

  it("gives the copied files back to the user the image runs as", async () => {
    const root = initialized();
    const { lines, runner } = recordingRunner();
    await syncComposeDeployment(root, "production", {}, runner);
    expect(
      lines.some((line) => line.includes("exec --user 0:0") && line.includes("chown -R 100:101")),
    ).toBe(true);
  });

  it("copies directory contents, not the directory itself", async () => {
    const root = initialized();
    const { lines, runner } = recordingRunner();
    await syncComposeDeployment(root, "production", {}, runner);
    const copy = lines.find((line) => line.includes("cp") && line.includes("apps/web/build/."));
    expect(copy).toBeDefined();
    expect(copy).toMatch(/:\/app\/apps\/web\/build$/);
  });

  it("restarts every container it copied into", async () => {
    const root = initialized({ worker: true });
    const { runner } = recordingRunner();
    const result = await syncComposeDeployment(root, "production", {}, runner);
    expect(result.restarted).toHaveLength(3);
    expect(result.copied.some((entry) => entry.source === "apps/api/dist")).toBe(true);
  });

  it("marks every container so the tag is not mistaken for the running code", async () => {
    const root = initialized();
    const { lines, runner } = recordingRunner();
    const result = await syncComposeDeployment(root, "production", {}, runner);
    expect(result.marker.note).toMatch(/not running the code its image tag describes/);
    expect(lines.filter((line) => line.includes(":/app/.podokit-sync.json"))).toHaveLength(2);
  });

  it("refuses while a release holds the deployment lock", async () => {
    const root = initialized();
    const { runner } = recordingRunner({ "deploy.lock": "abcd v1.2.3\n" });
    await expect(syncComposeDeployment(root, "production", {}, runner)).rejects.toThrow(
      /A release is in progress/,
    );
  });

  it("fails when a restarted container does not come back healthy", async () => {
    const root = initialized();
    const { runner } = recordingRunner({
      "{{json .}}": JSON.stringify({
        Config: { User: "100:101" },
        State: { Status: "running", Health: { Status: "unhealthy" } },
      }),
    });
    await expect(
      syncComposeDeployment(root, "production", { healthTimeoutMs: 0 }, runner),
    ).rejects.toThrow(/did not become healthy[\s\S]*--revert/);
  });

  it("refuses when no container is running to sync into", async () => {
    const root = initialized();
    const { runner } = recordingRunner({ "ps --filter": "" });
    await expect(syncComposeDeployment(root, "production", {}, runner)).rejects.toThrow(
      /No running container/,
    );
  });
});

describe("excluded artifacts", () => {
  it("keeps an excluded subtree out of what is copied", async () => {
    const root = initialized({ exclude: ["apps/web/build/client/agent"] });
    let staged: string | null = null;
    const { runner } = recordingRunner();
    const capturing: CommandRunner = (command, args, options) => {
      if (command === "docker" && args.includes("cp")) {
        const source = args[args.indexOf("cp") + 1];
        if (source?.includes("podokit-sync-") && source.endsWith("/.")) {
          staged = source.slice(0, -2);
          // Read it while it still exists; the staging directory is removed after
          // the copy that consumes it.
          expect(existsSync(join(staged, "client", "app.js"))).toBe(true);
          expect(existsSync(join(staged, "client", "agent"))).toBe(false);
        }
      }
      return runner(command, args, options);
    };
    await syncComposeDeployment(root, "production", {}, capturing);
    expect(staged).not.toBeNull();
  });

  it("refuses --clean rather than deleting artifacts this machine cannot rebuild", async () => {
    const root = initialized({ exclude: ["apps/web/build/client/agent"] });
    const { runner } = recordingRunner();
    await expect(
      syncComposeDeployment(root, "production", { clean: true }, runner),
    ).rejects.toThrow(/--clean cannot be used/);
  });
});

describe("drift and revert", () => {
  it("reports the containers running synced artifacts", () => {
    const marker = JSON.stringify({
      syncedAt: "2020-01-01T00:00:00.000Z",
      profile: "production",
      artifacts: ["apps/web/build"],
      note: "n",
    });
    const { runner } = recordingRunner({ "cat /app/.podokit-sync.json": marker });
    const drift = readComposeSyncDrift(initialized(), "production", runner);
    expect(drift).toHaveLength(2);
    expect(drift[0]?.marker.artifacts).toEqual(["apps/web/build"]);
  });

  it("reports nothing when no container carries a marker", () => {
    const { runner } = recordingRunner();
    expect(readComposeSyncDrift(initialized(), "production", runner)).toEqual([]);
  });

  it("reports nothing rather than failing when the target cannot be reached", () => {
    // status folds drift in, and losing the whole status report over an optional
    // field would hide the services list exactly when it is most needed.
    const { runner } = recordingRunner({ "ps --filter": "!docker daemon unreachable" });
    expect(readComposeSyncDrift(initialized(), "production", runner)).toEqual([]);
  });

  it("recreates the release the ledger records, not whatever file is on the target", async () => {
    const root = initialized();
    const { lines, runner } = recordingRunner({ "releases.json": ledger("v1.4.0") });
    const result = await revertComposeSync(root, "production", runner);

    expect(result.release).toBe("v1.4.0");
    const up = lines.find((line) => line.includes("up -d --force-recreate"));
    expect(up).toContain("--wait");
    expect(up?.startsWith("ssh podo@localhost")).toBe(true);

    // The file it copies across has to name the release being restored. Trusting the
    // file already on the target instead is what made the first revert attempt try to
    // pull a placeholder tag that never existed.
    const rendered = readFileSync(
      join(root, ".podokit", "runtime", "deploy", "production", "compose.yaml"),
      "utf8",
    );
    expect(rendered).toContain(":v1.4.0");
    expect(rendered).not.toContain(":v0.0.0");
  });

  it("refuses to revert a deployment that has never had a release applied", async () => {
    const { runner } = recordingRunner();
    await expect(revertComposeSync(initialized(), "production", runner)).rejects.toThrow(
      /No release has been applied/,
    );
  });

  it("never writes to the target while only reading status", () => {
    // The regression: status rendered a placeholder release purely to obtain a file
    // path, and every compose invocation copied that file to the target first -- so
    // reading the status replaced the applied project with one naming an image tag
    // that does not exist. It surfaced much later, as a failed recreate.
    const { lines, runner } = recordingRunner({ "releases.json": ledger("v1.4.0") });
    getComposeStatus(initialized(), "production", runner);
    expect(lines.filter((line) => line.startsWith("scp "))).toEqual([]);
    expect(lines.some((line) => line.includes("compose -p example-app ps"))).toBe(true);
  });
});
