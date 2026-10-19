import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  initializeDeploymentProfile,
  loadDeploymentProfile,
} from "./deploy-profile";
import { renderDeployment, type KubernetesRolloutState } from "./deploy-render";
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
  const secretNames = [
    "example-app-api",
    "example-app-postgres",
    "example-app-redis",
    "example-app-object-storage",
  ];

  function state(changed: Record<string, string> = {}, keep: Record<string, string> = {}): KubernetesRolloutState {
    return {
      secrets: Object.fromEntries(secretNames.map((name) => [name, changed[name] ?? `sha256:${name}-1`])),
      keep,
    };
  }

  /** The rollout checksum of each workload's pod template, by workload name. */
  function rolloutChecksums(manifest: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const document of manifest.split(/\n---\n/)) {
      const name = document.match(/^kind: (?:Deployment|StatefulSet)\nmetadata:\n {2}name: (\S+)/m)?.[1];
      const value = annotationValues(document, rolloutAnnotation)[0];
      if (name && value) result[name] = value;
    }
    return result;
  }

  function podTemplate(manifest: string, name: string): string {
    const document = manifest.split(/\n---\n/).find((entry) =>
      entry.startsWith(`apiVersion: apps/v1\nkind: StatefulSet\nmetadata:\n  name: ${name}\n`),
    );
    if (!document) throw new Error(`no StatefulSet ${name}`);
    return document.slice(document.indexOf("\n  template:\n"), document.indexOf("\n  volumeClaimTemplates:\n"));
  }

  it("restarts only the workloads that read a changed application Secret", () => {
    const { root, profile } = initializedProfile();
    const first = renderDeployment(root, "production", profile, "v1.2.3", undefined, state());
    const second = renderDeployment(
      root,
      "production",
      profile,
      "v1.2.3",
      undefined,
      state({ "example-app-api": "sha256:example-app-api-2" }),
    );

    expect(second.dependencyManifest).toBe(first.dependencyManifest);
    const before = rolloutChecksums(first.applicationManifest);
    const after = rolloutChecksums(second.applicationManifest);
    expect(Object.keys(before).sort()).toEqual(["example-app-api", "example-app-web", "example-app-worker"]);
    expect(after["example-app-api"]).not.toBe(before["example-app-api"]);
    expect(after["example-app-worker"]).not.toBe(before["example-app-worker"]);
    expect(after["example-app-web"]).toBe(before["example-app-web"]);
  });

  it("restarts only the dependency whose own Secret changed", () => {
    const { root, profile } = initializedProfile();
    const first = renderDeployment(root, "production", profile, "v1.2.3", undefined, state());
    const second = renderDeployment(
      root,
      "production",
      profile,
      "v1.2.3",
      undefined,
      state({ "example-app-postgres": "sha256:example-app-postgres-2" }),
    );

    const before = rolloutChecksums(first.dependencyManifest);
    const after = rolloutChecksums(second.dependencyManifest);
    expect(Object.keys(before).sort()).toEqual(["example-app-minio", "example-app-postgres", "example-app-redis"]);
    expect(after["example-app-postgres"]).not.toBe(before["example-app-postgres"]);
    expect(podTemplate(second.dependencyManifest, "example-app-redis")).toBe(
      podTemplate(first.dependencyManifest, "example-app-redis"),
    );
    expect(podTemplate(second.dependencyManifest, "example-app-minio")).toBe(
      podTemplate(first.dependencyManifest, "example-app-minio"),
    );
    expect(second.applicationManifest).toBe(first.applicationManifest);
    expect(second.dependencies.find((entry) => entry.name === "example-app-postgres")?.secretChecksum).not.toBe(
      first.dependencies.find((entry) => entry.name === "example-app-postgres")?.secretChecksum,
    );
  });

  it("keeps a dependency's live checksum and records its inputs outside the pod template", () => {
    const { root, profile } = initializedProfile();
    const live = "sha256:checksum-an-earlier-version-applied";
    const kept = renderDeployment(
      root,
      "production",
      profile,
      "v1.2.3",
      undefined,
      state({}, { "example-app-postgres": live }),
    );
    const keptAfterChange = renderDeployment(
      root,
      "production",
      profile,
      "v1.2.3",
      undefined,
      state({ "example-app-postgres": "sha256:example-app-postgres-2" }, { "example-app-postgres": live }),
    );

    expect(rolloutChecksums(kept.dependencyManifest)["example-app-postgres"]).toBe(live);
    // The pod template is what Kubernetes compares; the StatefulSet's own annotations do not roll pods.
    expect(podTemplate(keptAfterChange.dependencyManifest, "example-app-postgres")).toBe(
      podTemplate(kept.dependencyManifest, "example-app-postgres"),
    );
    expect(podTemplate(kept.dependencyManifest, "example-app-postgres")).not.toContain("secret-checksum");
    expect(podTemplate(kept.dependencyManifest, "example-app-postgres")).not.toContain("definition-checksum");
    expect(kept.dependencyManifest).toMatch(
      /kind: StatefulSet\nmetadata:\n {2}name: example-app-postgres\n {2}annotations:\n {4}podokit\.example\.com\/secret-checksum: "sha256:[a-f0-9]{64}"\n {4}podokit\.example\.com\/definition-checksum: "sha256:[a-f0-9]{64}"\nspec:/,
    );
  });

  it("records a definition checksum that ignores the image and the rollout checksum", () => {
    const { root, profile } = initializedProfile();
    const first = renderDeployment(root, "production", profile, "v1.2.3", undefined, state());
    profile.dependencies.postgres.image = "postgres:17.6-alpine";
    const newImage = renderDeployment(
      root,
      "production",
      profile,
      "v1.2.3",
      undefined,
      state({ "example-app-postgres": "sha256:example-app-postgres-2" }),
    );
    profile.dependencies.postgres.maxConnections = 200;
    const newArguments = renderDeployment(root, "production", profile, "v1.2.3", undefined, state());
    const definition = (runtime: typeof first) =>
      runtime.dependencies.find((entry) => entry.name === "example-app-postgres")?.definitionChecksum;

    expect(definition(newImage)).toBe(definition(first));
    expect(definition(newArguments)).not.toBe(definition(first));
    expect(newArguments.dependencies.find((entry) => entry.name === "example-app-postgres")?.args).toEqual([
      "-c",
      "max_connections=200",
    ]);
  });

  it("changes application checksums only when derived runtime config changes", () => {
    const { root, profile } = initializedProfile();
    const first = renderDeployment(root, "production", profile, "v1.2.3", undefined, state());
    profile.runtimeConfig.PUBLIC_LABEL = "updated";
    const second = renderDeployment(root, "production", profile, "v1.2.3", undefined, state());

    expect(second.dependencyManifest).toBe(first.dependencyManifest);
    expect(rolloutChecksums(second.applicationManifest)).toEqual(rolloutChecksums(first.applicationManifest));
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
    expect(manifest).not.toContain("kind: Middleware");
  });

  it("routes API paths to the API service through a prefix-stripping Ingress", () => {
    const { root, profile } = initializedProfile();
    profile.exposure.tlsSecretName = "app-tls";
    profile.exposure.apiPaths = ["/api/files/uploads/", "/api/imports"];

    const manifest = renderDeployment(root, "production", profile, "v1.2.3")
      .applicationManifest;
    const documents = manifest.split(/\n---\n/);
    const middleware = documents.find((document) => document.includes("kind: Middleware"));
    const apiIngress = documents.find((document) =>
      document.includes("name: example-app-api-paths"),
    );
    const webIngress = documents.find((document) =>
      /kind: Ingress\nmetadata:\n  name: example-app\n/.test(document),
    );

    expect(middleware).toBe(`apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: example-app-strip-api-prefix
spec:
  stripPrefix:
    prefixes: ["/api"]`);
    expect(apiIngress).toContain(
      'traefik.ingress.kubernetes.io/router.middlewares: "example-app-example-app-strip-api-prefix@kubernetescrd"',
    );
    expect(apiIngress).toContain('ingressClassName: "traefik"');
    expect(apiIngress).toContain('secretName: "app-tls"');
    expect(apiIngress).toContain('host: "app.example.com"');
    for (const base of ["/api/files/uploads", "/api/imports"]) {
      expect(apiIngress).toMatch(
        new RegExp(`path: "${base}"\\n\\s+pathType: Exact\\n\\s+backend:\\n\\s+service:\\n\\s+name: example-app-api\\n`),
      );
      expect(apiIngress).toMatch(
        new RegExp(`path: "${base}/"\\n\\s+pathType: ImplementationSpecific\\n\\s+backend:\\n\\s+service:\\n\\s+name: example-app-api\\n`),
      );
    }
    expect(apiIngress).not.toContain("example-app-web");
    // The main Ingress keeps every other request, including the rest of /api, on web.
    expect(webIngress).not.toContain("/api/");
    expect(webIngress).not.toContain("router.middlewares");
    expect(webIngress).toMatch(/path: \/\n\s+pathType: Prefix\n\s+backend:\n\s+service:\n\s+name: example-app-web/);
  });
});

describe("deployment pod termination", () => {
  function deploymentDocument(manifest: string, name: string): string {
    return manifest
      .split(/\n---\n/)
      .find((document) => document.includes("kind: Deployment") && document.includes(`name: ${name}\n`)) ?? "";
  }

  it("keeps API and web pods serving while they leave the Service's endpoints", () => {
    const { root, profile } = initializedProfile();
    const manifest = renderDeployment(root, "production", profile, "v1.2.3").applicationManifest;

    for (const name of ["example-app-api", "example-app-web"]) {
      const document = deploymentDocument(manifest, name);
      expect(document).toContain(
        '          lifecycle:\n            preStop:\n              exec: { command: [sleep, "5"] }\n',
      );
      // The 5 s sleep, the web server's 30 s drain and 1 s force-close, and a margin.
      expect(document).toContain("      terminationGracePeriodSeconds: 40\n");
    }
    const worker = deploymentDocument(manifest, "example-app-worker");
    expect(worker).toContain("kind: Deployment");
    expect(worker).not.toContain("preStop");
    expect(worker).not.toContain("terminationGracePeriodSeconds");
  });

  it("extends the grace period by the configured web shutdown timeout", () => {
    const { root, profile } = initializedProfile();
    profile.runtimeConfig = { ...profile.runtimeConfig, SHUTDOWN_TIMEOUT: "120" };
    const manifest = renderDeployment(root, "production", profile, "v1.2.3").applicationManifest;

    expect(deploymentDocument(manifest, "example-app-api")).toContain(
      "      terminationGracePeriodSeconds: 130\n",
    );
    expect(deploymentDocument(manifest, "example-app-web")).toContain(
      "      terminationGracePeriodSeconds: 130\n",
    );
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
