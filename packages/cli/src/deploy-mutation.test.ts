import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandRunner } from "./dev";
import {
  applyDeployment,
  planDeployment,
  planRollback,
  rollbackDeployment,
} from "./deploy";
import { initializeDeploymentProfile } from "./deploy-profile";
import { initLockfile } from "./lockfile";

const created: string[] = [];
const clusterOutput = "https://cluster.example.com\npublic-ca";
const fingerprint = `sha256:${createHash("sha256").update(clusterOutput).digest("hex")}`;

function initializedProject(): string {
  const root = mkdtempSync(join(tmpdir(), "podokit-deploy-mutation-"));
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
    clusterFingerprint: fingerprint,
    host: "app.example.com",
  });
  return root;
}

interface RunnerOptions {
  lockHeld?: boolean;
  failMigrationApply?: boolean;
}

function deploymentRunner(options: RunnerOptions = {}): {
  calls: Array<{ command: string; args: string[] }>;
  leaseTimestamps: Array<{ acquireTime: string; renewTime: string }>;
  runner: CommandRunner;
} {
  const calls: Array<{ command: string; args: string[] }> = [];
  const leaseTimestamps: Array<{ acquireTime: string; renewTime: string }> = [];
  let holderIdentity = "";
  const runner: CommandRunner = (command, args) => {
    calls.push({ command, args: [...args] });
    if (command === "docker") {
      if (args.includes("imagetools")) {
        return {
          status: 0,
          stdout: JSON.stringify({ digest: `sha256:${"b".repeat(64)}` }),
          stderr: "",
        };
      }
      return { status: 0, stdout: "github.com/docker/buildx v0.20.0", stderr: "" };
    }
    if (command === "helm") {
      if (args[0] === "version") {
        return { status: 0, stdout: "v3.17.0\n", stderr: "" };
      }
      if (args[0] === "status") {
        return {
          status: 0,
          stdout: JSON.stringify({ version: 7, info: { status: "deployed" } }),
          stderr: "",
        };
      }
      if (args[0] === "get" && args.includes("manifest")) {
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
        - image: "example-api:v1.2.2@sha256:${"c".repeat(64)}"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: example-app-web
spec:
  template:
    spec:
      containers:
        - image: "example-web:v1.2.2@sha256:${"d".repeat(64)}"
`,
          stderr: "",
        };
      }
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args.includes("config")) {
      return { status: 0, stdout: clusterOutput, stderr: "" };
    }
    if (args[0] === "--context" && args.includes("create") && args.includes("-f")) {
      if (options.lockHeld) {
        return {
          status: 1,
          stdout: "",
          stderr: 'Error from server (AlreadyExists): leases.coordination.k8s.io "lock" already exists',
        };
      }
      const manifestPath = args[args.indexOf("-f") + 1]!;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        spec: {
          holderIdentity: string;
          acquireTime: string;
          renewTime: string;
        };
      };
      holderIdentity = manifest.spec.holderIdentity;
      leaseTimestamps.push({
        acquireTime: manifest.spec.acquireTime,
        renewTime: manifest.spec.renewTime,
      });
      return { status: 0, stdout: "lease.coordination.k8s.io/lock created", stderr: "" };
    }
    if (args.includes("lease") && args.includes("jsonpath={.spec.holderIdentity}")) {
      return {
        status: 0,
        stdout: options.lockHeld ? "another-deployer" : holderIdentity,
        stderr: "",
      };
    }
    if (args.includes("namespace") || args.includes("ingressclass")) {
      return { status: 0, stdout: "resource/example", stderr: "" };
    }
    if (args.includes("can-i")) {
      return { status: 0, stdout: "yes\n", stderr: "" };
    }
    if (args.some((entry) => entry.includes(".metadata.uid"))) {
      return { status: 0, stdout: "uid:1", stderr: "" };
    }
    if (args.some((entry) => entry.startsWith("go-template="))) {
      return {
        status: 0,
        stdout: [
          "BETTER_AUTH_SECRET",
          "POSTGRES_DB",
          "POSTGRES_PASSWORD",
          "POSTGRES_USER",
        ].join("\n"),
        stderr: "",
      };
    }
    if (args.includes("jsonpath={.type}")) {
      return {
        status: 0,
        stdout: args.includes("registry-credentials")
          ? "kubernetes.io/dockerconfigjson"
          : "kubernetes.io/tls",
        stderr: "",
      };
    }
    if (args.includes("deployment") && args.includes("json")) {
      const name = args.find((entry) => entry === "example-app-api" || entry === "example-app-web")!;
      return {
        status: 0,
        stdout: JSON.stringify({
          metadata: { name },
          spec: {
            replicas: 2,
            template: {
              spec: {
                containers: [{ image: `${name}@sha256:${"e".repeat(64)}` }],
              },
            },
          },
          status: { readyReplicas: 2 },
        }),
        stderr: "",
      };
    }
    if (args.includes("pods")) {
      return { status: 0, stdout: "0\n0\n", stderr: "" };
    }
    if (
      options.failMigrationApply &&
      args.includes("apply") &&
      args.some((entry) => entry.endsWith("migration.yaml"))
    ) {
      return { status: 1, stdout: "", stderr: "migration apply failed" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  return { calls, leaseTimestamps, runner };
}

function successfulFetcher() {
  return vi.fn<typeof fetch>(async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/health/ready")) {
      return Response.json({ status: "ready" }, { status: 200 });
    }
    if (path.endsWith("/health")) {
      return Response.json({ status: "ok" }, { status: 200 });
    }
    return new Response("home", { status: 200 });
  });
}

afterEach(() => {
  for (const directory of created.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("deployment mutations", () => {
  it("holds a Lease across dependencies, migration, application, and verification", async () => {
    const root = initializedProject();
    const { calls, leaseTimestamps, runner } = deploymentRunner();
    const plan = planDeployment(root, "production", "v1.2.3", runner);
    const fetcher = successfulFetcher();

    const status = await applyDeployment(
      root,
      "production",
      "v1.2.3",
      plan.planHash,
      runner,
      fetcher,
    );

    expect(status.deployments).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(leaseTimestamps).toEqual([
      {
        acquireTime: expect.stringMatching(/\.\d{6}Z$/),
        renewTime: expect.stringMatching(/\.\d{6}Z$/),
      },
    ]);
    const mutationCalls = calls.slice(
      calls.findIndex(({ args }) => args.includes("create") && args.includes("-f")),
    );
    expect(mutationCalls[0]?.args).toContain("create");
    const upgrades = mutationCalls.filter(
      ({ command, args }) => command === "helm" && args[0] === "upgrade",
    );
    expect(upgrades).toHaveLength(2);
    expect(upgrades[0]?.args).toContain("example-app-dependencies");
    expect(upgrades[1]?.args).toContain("example-app");
    const migrationApply = mutationCalls.findIndex(
      ({ args }) =>
        args.includes("apply") && args.some((entry) => entry.endsWith("migration.yaml")),
    );
    const applicationUpgrade = mutationCalls.findIndex(
      ({ command, args }) =>
        command === "helm" && args[0] === "upgrade" && args[2] === "example-app",
    );
    expect(migrationApply).toBeGreaterThan(0);
    expect(applicationUpgrade).toBeGreaterThan(migrationApply);
    expect(mutationCalls.at(-1)?.args).toEqual(
      expect.arrayContaining(["delete", "lease", expect.stringContaining("deploy-lock")]),
    );
  });

  it("fails closed on a held Lease and releases the Lease after a mutation failure", async () => {
    const root = initializedProject();
    const held = deploymentRunner({ lockHeld: true });
    const heldPlan = planDeployment(root, "production", "v1.2.3", held.runner);
    await expect(
      applyDeployment(
        root,
        "production",
        "v1.2.3",
        heldPlan.planHash,
        held.runner,
        successfulFetcher(),
      ),
    ).rejects.toThrow("already held by another-deployer");
    expect(
      held.calls.some(
        ({ command, args }) => command === "helm" && args[0] === "upgrade",
      ),
    ).toBe(false);

    const failed = deploymentRunner({ failMigrationApply: true });
    const failedPlan = planDeployment(root, "production", "v1.2.3", failed.runner);
    await expect(
      applyDeployment(
        root,
        "production",
        "v1.2.3",
        failedPlan.planHash,
        failed.runner,
        successfulFetcher(),
      ),
    ).rejects.toThrow("failed with status 1");
    expect(
      failed.calls.some(
        ({ args }) => args.includes("delete") && args.includes("lease"),
      ),
    ).toBe(true);
  });

  it("locks rollback, restarts workloads for current Secrets, and verifies", async () => {
    const root = initializedProject();
    const { calls, runner } = deploymentRunner();
    const plan = planRollback(root, "production", 6, runner);

    await rollbackDeployment(
      root,
      "production",
      6,
      plan.planHash,
      runner,
      successfulFetcher(),
    );

    const lockIndex = calls.findIndex(({ args }) => args.includes("create") && args.includes("-f"));
    const rollbackIndex = calls.findIndex(
      ({ command, args }) => command === "helm" && args[0] === "rollback",
    );
    const restartCalls = calls.filter(
      ({ args }) => args.includes("rollout") && args.includes("restart"),
    );
    const releaseIndex = calls.findLastIndex(
      ({ args }) => args.includes("delete") && args.includes("lease"),
    );
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(rollbackIndex).toBeGreaterThan(lockIndex);
    expect(restartCalls).toHaveLength(2);
    expect(releaseIndex).toBeGreaterThan(rollbackIndex);
  });
});
