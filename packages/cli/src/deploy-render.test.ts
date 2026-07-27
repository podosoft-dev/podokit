import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  initializeDeploymentProfile,
  loadDeploymentProfile,
} from "./deploy-profile";
import { renderDeployment } from "./deploy-render";
import { initLockfile } from "./lockfile";

const created: string[] = [];
const rolloutAnnotation = "podokit.example.com/rollout-state-checksum";
const runtimeAnnotation = "podokit.example.com/runtime-config-checksum";

function initializedProfile() {
  const root = mkdtempSync(join(tmpdir(), "podokit-deploy-render-"));
  created.push(root);
  mkdirSync(join(root, "apps", "api"), { recursive: true });
  initLockfile(root, {
    template: "fullstack-nest-svelte",
    packageManager: "npm",
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
});
