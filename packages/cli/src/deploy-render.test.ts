import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  initializeDeploymentProfile,
  loadDeploymentProfile,
} from "./deploy-profile";
import { renderDeployment } from "./deploy-render";
import { initLockfile, readManifest, writeManifest } from "./lockfile";
import { resolveToolchain } from "./toolchain";

const created: string[] = [];
const rolloutAnnotation = "podokit.example.com/rollout-state-checksum";
const runtimeAnnotation = "podokit.example.com/runtime-config-checksum";

function initializedProfile() {
  const root = mkdtempSync(join(tmpdir(), "podokit-deploy-render-"));
  created.push(root);
  mkdirSync(join(root, "apps", "api"), { recursive: true });
  initLockfile(root, {
    template: "fullstack",
    answers: { projectName: "example-app" },
    version: "0.15.0",
  });
  initializeDeploymentProfile(root, "production", {
    context: "production",
    clusterFingerprint: `sha256:${"a".repeat(64)}`,
    host: "app.example.com",
  });
  const profile = loadDeploymentProfile(root, "production");
  profile.dependencies.redis.mode = "inCluster";
  profile.dependencies.objectStorage.mode = "inCluster";
  profile.workloads.worker = {
    replicas: 1,
    resources: {
      cpuRequest: "100m",
      cpuLimit: "500m",
      memoryRequest: "256Mi",
      memoryLimit: "512Mi",
    },
  };
  return { root, profile };
}

function annotationValues(manifest: string, annotation: string): string[] {
  const escaped = annotation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...manifest.matchAll(new RegExp(`${escaped}: "([^"]+)"`, "g"))].map(
    (match) => match[1]!,
  );
}

afterEach(() => {
  for (const directory of created.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("deployment rollout annotations", () => {
  it("changes every workload checksum without exposing rollout state", () => {
    const { root, profile } = initializedProfile();
    const sensitiveState = "secret-uid:resource-version-with-sensitive-marker";
    const first = renderDeployment(
      root,
      "production",
      profile,
      "v1.2.3",
      undefined,
      sensitiveState,
    );
    const second = renderDeployment(
      root,
      "production",
      profile,
      "v1.2.3",
      undefined,
      "changed-secret-state",
    );
    const firstDependency = annotationValues(first.dependencyManifest, rolloutAnnotation);
    const secondDependency = annotationValues(second.dependencyManifest, rolloutAnnotation);
    const firstApplication = annotationValues(first.applicationManifest, rolloutAnnotation);
    const secondApplication = annotationValues(second.applicationManifest, rolloutAnnotation);

    expect(firstDependency).toHaveLength(3);
    expect(firstApplication).toHaveLength(3);
    expect(secondDependency).not.toEqual(firstDependency);
    expect(secondApplication).not.toEqual(firstApplication);
    expect(first.dependencyManifest).not.toContain(sensitiveState);
    expect(first.applicationManifest).not.toContain(sensitiveState);
  });

  it("changes application checksums only when derived runtime config changes", () => {
    const { root, profile } = initializedProfile();
    const first = renderDeployment(
      root,
      "production",
      profile,
      "v1.2.3",
      undefined,
      "stable-secret-state",
    );
    profile.runtimeConfig.PUBLIC_LABEL = "updated";
    const second = renderDeployment(
      root,
      "production",
      profile,
      "v1.2.3",
      undefined,
      "stable-secret-state",
    );

    expect(annotationValues(second.dependencyManifest, rolloutAnnotation)).toEqual(
      annotationValues(first.dependencyManifest, rolloutAnnotation),
    );
    expect(annotationValues(second.applicationManifest, runtimeAnnotation)).not.toEqual(
      annotationValues(first.applicationManifest, runtimeAnnotation),
    );
  });

  it("renders deterministic offline rollout checksums", () => {
    const { root, profile } = initializedProfile();
    const first = renderDeployment(root, "production", profile, "v1.2.3");
    const second = renderDeployment(root, "production", profile, "v1.2.3");

    expect(second.dependencyManifest).toBe(first.dependencyManifest);
    expect(second.applicationManifest).toBe(first.applicationManifest);
  });

  it("nests explicit storage classes under persistent volume claim specs", () => {
    const { root, profile } = initializedProfile();
    profile.dependencies.postgres.storageClassName = "local-path";
    profile.dependencies.redis.storageClassName = "local-path";
    profile.dependencies.objectStorage.storageClassName = "local-path";

    const manifest = renderDeployment(
      root,
      "production",
      profile,
      "v1.2.3",
    ).dependencyManifest;

    expect(
      manifest.match(
        /\n {6}spec:\n {8}storageClassName: "local-path"\n {8}accessModes:/g,
      ),
    ).toHaveLength(3);
    expect(manifest).not.toContain("\n      spec:\n      storageClassName:");
  });

  it("labels the object storage initialization Job for lifecycle operations", () => {
    const { root, profile } = initializedProfile();
    const manifest = renderDeployment(
      root,
      "production",
      profile,
      "v1.2.3",
    ).dependencyManifest;

    expect(manifest).toMatch(
      /kind: Job\nmetadata:\n  name: example-app-minio-init-[a-f0-9]{8}\n  labels:\n    app\.kubernetes\.io\/name: example-app-minio-initialize\n    app\.kubernetes\.io\/managed-by: podokit\nspec:/,
    );
  });
});

describe("deployment ingress routing", () => {
  it("routes only configured exact WebSocket paths to the API service", () => {
    const { root, profile } = initializedProfile();
    profile.exposure.webSocketPaths = ["/events/ws", "/notifications/socket"];

    const manifest = renderDeployment(root, "production", profile, "v1.2.3")
      .applicationManifest;

    expect(manifest).toMatch(
      /path: "\/events\/ws"\n\s+pathType: Exact\n\s+backend:\n\s+service:\n\s+name: example-app-api/,
    );
    expect(manifest).toMatch(
      /path: "\/notifications\/socket"\n\s+pathType: Exact\n\s+backend:\n\s+service:\n\s+name: example-app-api/,
    );
    expect(manifest).toMatch(
      /path: \/\n\s+pathType: Prefix\n\s+backend:\n\s+service:\n\s+name: example-app-web/,
    );
    expect(manifest.indexOf('path: "/events/ws"')).toBeLessThan(manifest.lastIndexOf("path: /"));
  });
});

describe("deployment migration command", () => {
  it("runs workers with Bun", () => {
    const { root, profile } = initializedProfile();
    const runtime = renderDeployment(root, "production", profile, "v1.2.3");

    expect(runtime.applicationManifest).toContain(
      "command: [bun, dist/main-worker.js]",
    );
  });

  it("renders the default migration command when the profile omits it", () => {
    const { root, profile } = initializedProfile();
    const runtime = renderDeployment(root, "production", profile, "v1.2.3");

    expect(readFileSync(runtime.migrationManifest, "utf8")).toContain(
      "command: [bun, run, migrate:all]",
    );
  });

  it("renders a custom migration command from the profile", () => {
    const { root, profile } = initializedProfile();
    profile.migration = { command: ["node", "dist/migrate"] };
    const runtime = renderDeployment(root, "production", profile, "v1.2.3");

    expect(readFileSync(runtime.migrationManifest, "utf8")).toContain(
      "command: [node, dist/migrate]",
    );
  });

  it("uses Bun for the default migration in a Bun project", () => {
    const { root, profile } = initializedProfile();
    const manifest = readManifest(root);
    if (!manifest) throw new Error("expected manifest");
    writeManifest(root, { ...manifest, toolchain: resolveToolchain("bun") });

    const runtime = renderDeployment(root, "production", profile, "v1.2.3");

    expect(readFileSync(runtime.migrationManifest, "utf8")).toContain(
      "command: [bun, run, migrate:all]",
    );
  });
});
