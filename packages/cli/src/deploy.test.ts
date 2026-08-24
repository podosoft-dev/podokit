import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandRunner } from "./dev";
import {
  doctorDeployment,
  getDeploymentStatus,
  planDeployment,
  planRollback,
  verifyDeployment,
} from "./deploy";
import {
  initializeDeploymentProfile,
  loadDeploymentProfile,
  profilePath,
} from "./deploy-profile";
import { renderDeployment } from "./deploy-render";
import { initLockfile } from "./lockfile";

const created: string[] = [];
const clusterOutput = "https://cluster.example.com\npublic-ca";
const fingerprint = `sha256:${createHash("sha256").update(clusterOutput).digest("hex")}`;
const mismatchedFingerprint = `sha256:${"a".repeat(64)}`;

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "podokit-deploy-"));
  created.push(root);
  mkdirSync(join(root, "apps", "api"), { recursive: true });
  initLockfile(root, {
    template: "fullstack",
    answers: { projectName: "example-app" },
    version: "0.15.0",
  });
  return root;
}

function initializedProject(): string {
  const root = project();
  initializeDeploymentProfile(root, "production", {
    context: "production",
    clusterFingerprint: fingerprint,
    host: "app.example.com",
  });
  return root;
}

afterEach(() => {
  for (const directory of created.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("deployment profiles", () => {
  it("initializes and validates a secret-free production profile", () => {
    const root = initializedProject();
    const profile = loadDeploymentProfile(root, "production");
    expect(profile.target.context).toBe("production");
    expect(profile.target.createNamespace).toBe(false);
    expect(profile.release.apiRepository).toBe("ghcr.io/example/example-app-api");
    expect(profile.workloads.api.replicas).toBe(2);
    expect(readFileSync(profilePath(root, "production"), "utf8")).not.toContain("PASSWORD");
  });

  it("rejects secrets, latest images, and path-like profile names", () => {
    const root = initializedProject();
    const path = profilePath(root, "production");
    const profile = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    profile.runtimeConfig = { API_TOKEN: "plaintext" };
    writeFileSync(path, JSON.stringify(profile));
    expect(() => loadDeploymentProfile(root, "production")).toThrow("may contain a secret");
    expect(() => profilePath(root, "../production")).toThrow("Invalid deployment profile name");

    profile.runtimeConfig = {};
    const dependencies = profile.dependencies as Record<string, Record<string, unknown>>;
    dependencies.postgres!.image = "postgres:latest";
    writeFileSync(path, JSON.stringify(profile));
    expect(() => loadDeploymentProfile(root, "production")).toThrow("explicit non-latest");

    dependencies.postgres!.image = "postgres:16.10-alpine";
    profile.runtimeConfig = { DATABASE_URL: "postgres://user:password@db.example.com/app" };
    writeFileSync(path, JSON.stringify(profile));
    expect(() => loadDeploymentProfile(root, "production")).toThrow("contains URL credentials");
  });

  it("accepts registry ports but rejects tagged release repositories", () => {
    const root = initializedProject();
    const path = profilePath(root, "production");
    const profile = JSON.parse(readFileSync(path, "utf8")) as {
      release: { apiRepository: string; webRepository: string };
      dependencies: {
        postgres: { image: string };
      };
    };
    profile.release.apiRepository = "registry.example.com:5000/team/example-api";
    profile.release.webRepository = "registry.example.com:5000/team/example-web";
    profile.dependencies.postgres.image = "registry.example.com:5000/library/postgres:16.10";
    writeFileSync(path, JSON.stringify(profile));
    expect(loadDeploymentProfile(root, "production").release.apiRepository).toBe(
      "registry.example.com:5000/team/example-api",
    );

    profile.release.apiRepository = "registry.example.com/team/example-api:v1";
    writeFileSync(path, JSON.stringify(profile));
    expect(() => loadDeploymentProfile(root, "production")).toThrow(
      "image repository without a tag or digest",
    );
  });

  it("derives production requirements and workloads from installed modules", () => {
    const root = project();
    const manifestPath = join(root, ".podokit", "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      modules: Array<{ name: string; order: number; addedWith: string }>;
    };
    manifest.modules = [
      "auth",
      "redis",
      "sse",
      "bullmq",
      "object-storage-s3",
      "rate-limit",
    ].map(
      (name, order) => ({ name, order, addedWith: "0.15.0" }),
    );
    writeFileSync(manifestPath, JSON.stringify(manifest));
    initializeDeploymentProfile(root, "production", {
      context: "production",
      clusterFingerprint: fingerprint,
      host: "app.example.com",
    });
    const profile = loadDeploymentProfile(root, "production");
    expect(profile.secrets.api.requiredKeys).toContain("BETTER_AUTH_SECRET");
    expect(profile.dependencies.redis.mode).toBe("inCluster");
    expect(profile.dependencies.objectStorage.mode).toBe("inCluster");
    expect(profile.workloads.worker?.replicas).toBe(1);
    expect(profile.runtimeConfig).toMatchObject({
      NODE_ENV: "production",
      BETTER_AUTH_URL: "https://app.example.com",
      SSE_TRANSPORT: "redis",
      RATE_LIMIT_AUTH_MAX: "20",
      RATE_LIMIT_TRUSTED_PROXY_HOPS: "1",
    });
  });

  it("selects Redis transport for multi-replica SSE profiles", () => {
    const root = project();
    const manifestPath = join(root, ".podokit", "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      modules: Array<{ name: string; order: number; addedWith: string }>;
    };
    manifest.modules = [{ name: "sse", order: 0, addedWith: "0.15.0" }];
    writeFileSync(manifestPath, JSON.stringify(manifest));
    initializeDeploymentProfile(root, "production", {
      context: "production",
      clusterFingerprint: fingerprint,
      host: "app.example.com",
    });
    const profile = loadDeploymentProfile(root, "production");
    expect(profile.workloads.api.replicas).toBe(2);
    expect(profile.dependencies.redis.mode).toBe("inCluster");
    expect(profile.runtimeConfig.SSE_TRANSPORT).toBe("redis");
  });
});

describe("deployment rendering and planning", () => {
  it("renders a web-only ingress, pinned release images, and ready API probes", () => {
    const root = initializedProject();
    const profile = loadDeploymentProfile(root, "production");
    const runtime = renderDeployment(root, "production", profile, "v1.2.3");

    expect(runtime.applicationManifest).toContain(
      'image: "ghcr.io/example/example-app-api:v1.2.3"',
    );
    expect(runtime.applicationManifest).toContain("path: /health/ready");
    expect(runtime.applicationManifest).toContain(
      "labels:\n        app.kubernetes.io/name: example-app-api",
    );
    expect(runtime.applicationManifest).toContain("name: example-app-web");
    expect(runtime.applicationManifest).not.toContain("backend:\n              service:\n                name: example-app-api");
    expect(runtime.applicationManifest.match(/secretRef:/g)).toHaveLength(1);
    expect(runtime.dependencyManifest).toContain("kind: StatefulSet");
    expect(runtime.applicationManifest).toContain('PORT: "3000"');
    expect(runtime.applicationManifest).toContain(
      'BACKEND_INTERNAL_URL: "http://example-app-api:3000"',
    );
    expect(runtime.applicationManifest).not.toContain(
      "name: example-app-web\n          image",
    );
    expect(readFileSync(runtime.migrationManifest, "utf8")).toContain(
      "command: [bun, run, migrate:all]",
    );
    expect(() =>
      renderDeployment(root, "../outside", profile, "v1.2.3"),
    ).toThrow("Invalid deployment profile name");
  });

  it("keeps runtime values inert inside Helm charts", () => {
    const root = initializedProject();
    const path = profilePath(root, "production");
    const profileValue = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    profileValue.runtimeConfig = { PUBLIC_LABEL: "{{ fail \"must-not-run\" }}" };
    writeFileSync(path, JSON.stringify(profileValue));
    const profile = loadDeploymentProfile(root, "production");
    const runtime = renderDeployment(root, "production", profile, "v1.2.3");
    expect(runtime.applicationManifest).toContain('{{ fail \\"must-not-run\\" }}');
    expect(
      readFileSync(join(runtime.applicationChart, "templates", "resources.yaml"), "utf8"),
    ).toBe('{{ .Files.Get "resources.yaml" }}\n');
  });

  it("rejects unknown profile fields and origin-changing verification paths", () => {
    const root = initializedProject();
    const path = profilePath(root, "production");
    const profile = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    profile.plaintextPassword = "must-not-be-ignored";
    writeFileSync(path, JSON.stringify(profile));
    expect(() => loadDeploymentProfile(root, "production")).toThrow("unknown key");

    delete profile.plaintextPassword;
    const verification = profile.verification as {
      checks: Array<Record<string, unknown>>;
    };
    verification.checks[0]!.path = "/\\external.example/path";
    writeFileSync(path, JSON.stringify(profile));
    expect(() => loadDeploymentProfile(root, "production")).toThrow("absolute URL path");
  });

  it("rejects custom release tag regular expressions", () => {
    const root = initializedProject();
    const path = profilePath(root, "production");
    const profile = JSON.parse(readFileSync(path, "utf8")) as {
      release: { tagPattern: string };
    };
    profile.release.tagPattern = "^(a+)+$";
    writeFileSync(path, JSON.stringify(profile));
    expect(() => loadDeploymentProfile(root, "production")).toThrow(
      "stable vMAJOR.MINOR.PATCH",
    );
  });

  it("creates a deterministic plan tied to the current Helm revision", () => {
    const root = initializedProject();
    const path = profilePath(root, "production");
    const profile = JSON.parse(readFileSync(path, "utf8")) as {
      exposure: { tlsSecretName: string | null };
    };
    profile.exposure.tlsSecretName = "example-app-tls";
    writeFileSync(path, JSON.stringify(profile));
    let digestCharacter = "b";
    let secretVersion = "1";
    let helmStatus = "deployed";
    const calls: string[][] = [];
    const runner: CommandRunner = (_command, args) => {
      calls.push(args);
      if (args.includes("config")) {
        return { status: 0, stdout: clusterOutput, stderr: "" };
      }
      if (args.includes("imagetools")) {
        return {
          status: 0,
          stdout: JSON.stringify({ digest: `sha256:${digestCharacter.repeat(64)}` }),
          stderr: "",
        };
      }
      if (args.some((entry) => entry.includes(".metadata.uid"))) {
        return { status: 0, stdout: `uid:${secretVersion}`, stderr: "" };
      }
      if (args.includes("status")) {
        return {
          status: 0,
          stdout: JSON.stringify({ version: 7, info: { status: helmStatus } }),
          stderr: "",
        };
      }
      return { status: 0, stdout: "", stderr: "" };
    };
    const first = planDeployment(root, "production", "v1.2.3", runner);
    const second = planDeployment(root, "production", "v1.2.3", runner);
    expect(first.planHash).toBe(second.planHash);
    expect(first.currentRevision).toBe(7);
    expect(first.currentStatus).toBe("deployed");
    expect(first.target.clusterFingerprint).toBe(fingerprint);
    expect(first.images.api).toContain(`:v1.2.3@sha256:${"b".repeat(64)}`);
    expect(calls.some((args) => args.includes("example-app-tls"))).toBe(true);
    expect(existsSync(join(root, ".podokit", "runtime"))).toBe(false);
    digestCharacter = "c";
    expect(planDeployment(root, "production", "v1.2.3", runner).planHash).not.toBe(
      first.planHash,
    );
    digestCharacter = "b";
    secretVersion = "2";
    expect(planDeployment(root, "production", "v1.2.3", runner).planHash).not.toBe(
      first.planHash,
    );
    secretVersion = "1";
    helmStatus = "pending-upgrade";
    expect(planDeployment(root, "production", "v1.2.3", runner).planHash).not.toBe(
      first.planHash,
    );
    expect(() => planDeployment(root, "production", "latest", runner)).toThrow(
      "does not match deployment tag pattern",
    );
  });

  it("binds rollback confirmation to the target and current revision", () => {
    const root = initializedProject();
    const runner: CommandRunner = (_command, args) => {
      if (args.includes("config")) {
        return { status: 0, stdout: clusterOutput, stderr: "" };
      }
      if (args.some((entry) => entry.includes(".metadata.uid"))) {
        return { status: 0, stdout: "uid:1", stderr: "" };
      }
      if (args.includes("manifest")) {
        return {
          status: 0,
          stdout: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: example-app-api
spec:
  template:
    spec:
      containers:
        - image: "example-api:v1.2.3@sha256:${"b".repeat(64)}"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: example-app-web
spec:
  template:
    spec:
      containers:
        - image: "example-web:v1.2.3@sha256:${"c".repeat(64)}"
`,
          stderr: "",
        };
      }
      return {
        status: 0,
        stdout: JSON.stringify({ version: 4, info: { status: "deployed" } }),
        stderr: "",
      };
    };
    const revisionTwo = planRollback(root, "production", 2, runner);
    const revisionThree = planRollback(root, "production", 3, runner);
    expect(revisionTwo.planHash).not.toBe(revisionThree.planHash);
    expect(revisionTwo.images.api).toContain("@sha256:");
    expect(revisionTwo.targetRevisionManifestDigest).toMatch(/^sha256:/);
    expect(revisionTwo.warnings.join(" ")).toContain("database migrations");
  });
});

describe("deployment doctor and verification", () => {
  it("checks only secret key names and refuses a mismatched cluster fingerprint", () => {
    const root = initializedProject();
    const path = profilePath(root, "production");
    const profile = JSON.parse(readFileSync(path, "utf8")) as {
      target: { clusterFingerprint: string };
    };
    profile.target.clusterFingerprint = fingerprint;
    writeFileSync(path, JSON.stringify(profile));

    const calls: string[][] = [];
    const runner: CommandRunner = (_command, args) => {
      calls.push(args);
      if (args.includes("config")) return { status: 0, stdout: clusterOutput, stderr: "" };
      if (args[0] === "version") return { status: 0, stdout: "v4.0.0\n", stderr: "" };
      if (args.includes("namespace")) return { status: 0, stdout: "namespace/production\n", stderr: "" };
      if (args.includes("can-i")) return { status: 0, stdout: "yes\n", stderr: "" };
      if (args.includes("example-app-postgres")) {
        return {
          status: 0,
          stdout: "POSTGRES_DB\nPOSTGRES_PASSWORD\nPOSTGRES_USER\n",
          stderr: "",
        };
      }
      if (args.includes("example-app-api")) {
        return {
          status: 0,
          stdout: "POSTGRES_DB\nPOSTGRES_PASSWORD\nPOSTGRES_USER\n",
          stderr: "",
        };
      }
      if (args.includes("registry-credentials")) {
        return {
          status: 0,
          stdout: "kubernetes.io/dockerconfigjson",
          stderr: "",
        };
      }
      if (args.includes("secret")) return { status: 0, stdout: "placeholder\n", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };
    const findings = doctorDeployment(root, "production", runner);
    expect(findings.every((finding) => finding.ok)).toBe(true);
    expect(calls.some((args) => args.join(" ").includes("go-template="))).toBe(true);
    expect(calls.every((args) => !args.includes("-o=secret"))).toBe(true);

    profile.target.clusterFingerprint = mismatchedFingerprint;
    writeFileSync(path, JSON.stringify(profile));
    expect(
      doctorDeployment(root, "production", runner).find(
        (finding) => finding.code === "cluster-fingerprint",
      )?.ok,
    ).toBe(false);
  });

  it("refuses to plan or report status when the target cluster is inaccessible", () => {
    const root = initializedProject();
    const runner: CommandRunner = () => ({
      status: 1,
      stdout: "",
      stderr: "context deadline exceeded",
    });
    expect(() => planDeployment(root, "production", "v1.2.3", runner)).toThrow(
      "context deadline exceeded",
    );
    expect(() => getDeploymentStatus(root, "production", runner)).toThrow(
      "context deadline exceeded",
    );
  });

  it("fails closed on malformed successful Helm and Kubernetes responses", () => {
    const root = initializedProject();
    const malformedHelm: CommandRunner = (_command, args) => {
      if (args.includes("config")) {
        return { status: 0, stdout: clusterOutput, stderr: "" };
      }
      return { status: 0, stdout: "not-json", stderr: "" };
    };
    expect(() => getDeploymentStatus(root, "production", malformedHelm)).toThrow(
      "Helm status for release example-app returned invalid JSON",
    );

    const malformedDeployment: CommandRunner = (_command, args) => {
      if (args.includes("config")) {
        return { status: 0, stdout: clusterOutput, stderr: "" };
      }
      if (args.includes("status")) {
        return {
          status: 0,
          stdout: JSON.stringify({ version: 1, info: { status: "deployed" } }),
          stderr: "",
        };
      }
      if (args.includes("deployment")) {
        return { status: 0, stdout: "{}", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };
    expect(() => getDeploymentStatus(root, "production", malformedDeployment)).toThrow(
      "Kubernetes Deployment example-app-api has an invalid schema",
    );
  });

  it("reports partial workload state without hiding a missing deployment", () => {
    const root = initializedProject();
    const runner: CommandRunner = (_command, args) => {
      if (args.includes("config")) {
        return { status: 0, stdout: clusterOutput, stderr: "" };
      }
      if (args.includes("status")) {
        return { status: 1, stdout: "", stderr: "Error: release: not found" };
      }
      if (args.includes("example-app-api") && args.includes("deployment")) {
        return {
          status: 0,
          stdout: JSON.stringify({
            metadata: { name: "example-app-api" },
            spec: {
              replicas: 2,
              template: { spec: { containers: [{ image: "api@sha256:abc" }] } },
            },
            status: { readyReplicas: 1 },
          }),
          stderr: "",
        };
      }
      if (args.includes("example-app-web") && args.includes("deployment")) {
        return { status: 1, stdout: "", stderr: "Error from server (NotFound)" };
      }
      if (args.includes("pods")) {
        return { status: 0, stdout: "0\n", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };
    const status = getDeploymentStatus(root, "production", runner);
    expect(status.helmStatus).toBe("not-installed");
    expect(status.deployments).toEqual([
      expect.objectContaining({ name: "example-app-api", readyReplicas: 1 }),
    ]);
  });

  it("verifies every configured public path without following redirects", async () => {
    const root = initializedProject();
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/health/ready")) {
        return Response.json({ status: "not-ready" }, { status: 503 });
      }
      if (url.endsWith("/api/health")) {
        return Response.json({ status: "ok" }, { status: 200 });
      }
      return new Response("home", { status: 200 });
    });
    const result = await verifyDeployment(root, "production", fetcher);
    expect(result.ok).toBe(false);
    expect(result.paths).toHaveLength(3);
    expect(result.paths.find((entry) => entry.path === "/api/health/ready")?.status).toBe(503);
  });
});
