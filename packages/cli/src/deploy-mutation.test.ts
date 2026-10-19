import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandRunner } from "./dev";
import {
  applyDeployment,
  planDeployment,
  planRollback,
  rollbackDeployment,
} from "./deploy";
import {
  initializeDeploymentProfile,
  loadDeploymentProfile,
  profilePath,
} from "./deploy-profile";
import { initLockfile } from "./lockfile";

const created: string[] = [];
const clusterOutput = "https://cluster.example.com\npublic-ca";
const fingerprint = `sha256:${createHash("sha256").update(clusterOutput).digest("hex")}`;
const storageImage = `example.com/podokit-storage:v1.0.0@sha256:${"b".repeat(64)}`;

function initializedProject(): string {
  const root = mkdtempSync(join(tmpdir(), "podokit-deploy-mutation-"));
  created.push(root);
  mkdirSync(join(root, "apps", "api"), { recursive: true });
  initLockfile(root, {
    template: "fullstack",
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

function storageProject(mode: "inCluster" | "external" = "inCluster"): string {
  const root = initializedProject();
  const profile = loadDeploymentProfile(root, "production");
  profile.dependencies.objectStorage.mode = mode;
  profile.dependencies.objectStorage.image = storageImage;
  writeFileSync(profilePath(root, "production"), JSON.stringify(profile));
  return root;
}

function storageStatefulSet(image = storageImage): unknown {
  return {
    apiVersion: "apps/v1",
    kind: "StatefulSet",
    metadata: { name: "example-app-minio", namespace: "example-app" },
    spec: { template: { spec: { containers: [{ name: "minio", image }] } } },
  };
}

interface RunnerOptions {
  lockHeld?: boolean;
  failMigrationApply?: boolean;
  helmVersion?: string;
  storageResource?: unknown;
  storageReadFails?: boolean;
  storageMissing?: boolean;
  dependencyMissing?: boolean;
  dependencyStatus?: string;
  failDependencyUpgrade?: boolean;
  recordedStorageResource?: unknown;
  recordedStorageReadFails?: boolean;
  recordedStorageParseFails?: boolean;
  recordedStorageOutput?: string;
  migrationJob?: unknown;
  migrationPods?: unknown[];
  migrationLogs?: string;
  migrationLedger?: string;
  failMigrationWait?: boolean;
  failLedgerWrite?: boolean;
}

function deploymentRunner(options: RunnerOptions = {}): {
  calls: Array<{ command: string; args: string[] }>;
  leaseTimestamps: Array<{ acquireTime: string; renewTime: string }>;
  ledgerWrites: unknown[];
  runner: CommandRunner;
} {
  const calls: Array<{ command: string; args: string[] }> = [];
  const ledgerWrites: unknown[] = [];
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
        return { status: 0, stdout: `${options.helmVersion ?? "v3.17.0"}\n`, stderr: "" };
      }
      if (args[0] === "status") {
        if (args[1] === "example-app-dependencies" && options.dependencyMissing) {
          return { status: 1, stdout: "", stderr: "release: not found" };
        }
        return {
          status: 0,
          stdout: JSON.stringify({
            version: 7,
            info: {
              status: args[1] === "example-app-dependencies"
                ? options.dependencyStatus ?? "deployed"
                : "deployed",
            },
          }),
          stderr: "",
        };
      }
      if (args[0] === "get" && args.includes("manifest")) {
        if (args[2] === "example-app-dependencies") {
          return {
            status: options.recordedStorageReadFails ? 1 : 0,
            stdout: `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: example-app-minio
spec:
  template:
    spec:
      containers:
        - name: minio
          image: "${storageImage}"
`,
            stderr: options.recordedStorageReadFails ? "private Helm diagnostic" : "",
          };
        }
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
      if (args[0] === "upgrade" && args[2] === "example-app-dependencies" && options.failDependencyUpgrade) {
        return { status: 1, stdout: "", stderr: "dependency upgrade failed" };
      }
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args.includes("config")) {
      return { status: 0, stdout: clusterOutput, stderr: "" };
    }
    if (args.includes("pods") && args.some((entry) => entry.startsWith("job-name="))) {
      return { status: 0, stdout: JSON.stringify({ items: options.migrationPods ?? [] }), stderr: "" };
    }
    if (args.includes("logs")) {
      return { status: 0, stdout: options.migrationLogs ?? "", stderr: "" };
    }
    if (args.includes("create") && args.includes("--dry-run=client")) {
      expect(args).toContain("--validate=false");
      const path = args[args.indexOf("-f") + 1]!;
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
      expect(readFileSync(path, "utf8")).toContain("kind: StatefulSet");
      return {
        status: options.recordedStorageParseFails ? 1 : 0,
        stdout: options.recordedStorageOutput ?? (options.recordedStorageResource === undefined
          ? [
              { apiVersion: "v1", kind: "Service", metadata: { name: "example-app-minio" } },
              storageStatefulSet(),
              { apiVersion: "batch/v1", kind: "Job", metadata: { name: "example-app-minio-initialize" }, spec: { command: ['quoted "value" with \\ and }{ braces'] } },
            ].map((resource) => JSON.stringify(resource, null, 2)).join("\n")
          : JSON.stringify(options.recordedStorageResource)),
        stderr: options.recordedStorageParseFails ? "private parser diagnostic" : "",
      };
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
          "MINIO_ROOT_USER",
          "MINIO_ROOT_PASSWORD",
          "S3_ACCESS_KEY_ID",
          "S3_SECRET_ACCESS_KEY",
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
          metadata: { name, annotations: { "deployment.kubernetes.io/revision": "2" } },
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
    if (args.includes("statefulset") && args.includes("json")) {
      return {
        status: options.storageReadFails ? 1 : 0,
        stdout: options.storageMissing ? "" : JSON.stringify(
          options.storageResource === undefined ? storageStatefulSet() : options.storageResource,
        ),
        stderr: options.storageReadFails ? "private diagnostic" : "",
      };
    }
    if (args.includes("replicasets")) {
      return {
        status: 0,
        stdout: JSON.stringify({
          items: [{
            metadata: {
              annotations: { "deployment.kubernetes.io/revision": "2" },
              labels: { "pod-template-hash": "current" },
            },
          }],
        }),
        stderr: "",
      };
    }
    if (args.includes("pods")) {
      const current = {
        metadata: { labels: { "pod-template-hash": "current" } },
        status: { containerStatuses: [{ restartCount: 0 }] },
      };
      return { status: 0, stdout: JSON.stringify({ items: [current, current] }), stderr: "" };
    }
    if (
      options.failMigrationApply &&
      args.includes("apply") &&
      args.some((entry) => entry.endsWith("migration.yaml"))
    ) {
      return { status: 1, stdout: "", stderr: "migration apply failed" };
    }
    if (options.failMigrationWait && args.includes("wait") && args.some((entry) => entry.startsWith("job/"))) {
      return { status: 1, stdout: "", stderr: "timed out waiting for the condition" };
    }
    if (args.includes("get") && args.includes("job") && args.includes("json")) {
      const job = options.migrationJob ?? {
        status: { startTime: "2026-10-19T07:38:08Z", conditions: [{ type: "Complete", status: "True" }] },
      };
      return { status: 0, stdout: JSON.stringify(job), stderr: "" };
    }
    if (args.includes("get") && args.includes("configmap")) {
      return { status: 0, stdout: options.migrationLedger ?? "", stderr: "" };
    }
    if (args.includes("apply") && args.includes("--server-side")) {
      ledgerWrites.push(JSON.parse(readFileSync(args[args.indexOf("-f") + 1]!, "utf8")) as unknown);
      return options.failLedgerWrite
        ? { status: 1, stdout: "", stderr: "configmaps is forbidden" }
        : { status: 0, stdout: "configmap/example-app-migrations serverside-applied", stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  return { calls, leaseTimestamps, ledgerWrites, runner };
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
  vi.restoreAllMocks();
  for (const directory of created.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("deployment mutations", () => {
  describe.each([
    ["v3.17.0", "--atomic"],
    ["v4.0.0", "--rollback-on-failure"],
  ])("managed storage recovery with Helm %s", (helmVersion, failureFlag) => {
    it.each([
      ["changed image", { storageResource: storageStatefulSet(`example.com/podokit-storage:v0.9.0@sha256:${"c".repeat(64)}`) }],
      ["unreadable StatefulSet", { storageReadFails: true }],
      ["missing existing StatefulSet", { storageMissing: true }],
      ["invalid StatefulSet schema", { storageResource: null }],
      ["wrong resource identity", { storageResource: { ...storageStatefulSet() as object, metadata: { name: "other-storage", namespace: "example-app" } } }],
      ["unknown storage container", { storageResource: { ...storageStatefulSet() as object, spec: { template: { spec: { containers: [{ name: "other", image: storageImage }] } } } } }],
      ["failed previous dependency release", { dependencyStatus: "failed" }],
      ["older image recorded by Helm", { recordedStorageResource: storageStatefulSet(`example.com/podokit-storage:v0.9.0@sha256:${"c".repeat(64)}`) }],
      ["unreadable Helm manifest", { recordedStorageReadFails: true }],
      ["invalid Helm manifest YAML", { recordedStorageParseFails: true }],
      ["invalid recorded StatefulSet schema", { recordedStorageResource: null }],
      ["duplicate recorded StatefulSets", { recordedStorageResource: { apiVersion: "v1", kind: "List", items: [storageStatefulSet(), storageStatefulSet()] } }],
      ["malformed recorded JSON output", { recordedStorageOutput: '{"kind":"StatefulSet"}unexpected' }],
      ["truncated recorded JSON output", { recordedStorageOutput: JSON.stringify(storageStatefulSet()).slice(0, -1) }],
    ] satisfies Array<[string, RunnerOptions]>)("disables dependency rollback for %s and keeps application rollback", async (_name, options) => {
      const root = storageProject();
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { calls, runner } = deploymentRunner({ helmVersion, ...options });
      const plan = planDeployment(root, "production", "v1.2.3", runner);
      expect(calls.some(({ args }) => args.includes("statefulset") && args.includes("json"))).toBe(false);

      await applyDeployment(root, "production", "v1.2.3", plan.planHash, runner, successfulFetcher());

      const upgrades = calls.filter(({ command, args }) => command === "helm" && args[0] === "upgrade");
      expect(upgrades).toHaveLength(2);
      expect(upgrades[0]?.args).not.toContain(failureFlag);
      expect(upgrades[0]?.args).toEqual(expect.arrayContaining(["--wait", "--timeout", "5m"]));
      expect(upgrades[1]?.args).toContain(failureFlag);
      expect(warning).toHaveBeenCalledWith(expect.stringContaining("restore the complete data and IAM backup"));
      expect(JSON.stringify(warning.mock.calls)).not.toContain("private diagnostic");
      expect(JSON.stringify(warning.mock.calls)).not.toContain("private Helm diagnostic");
      expect(JSON.stringify(warning.mock.calls)).not.toContain("private parser diagnostic");
      const readIndex = calls.findIndex(({ args }) => args.includes("statefulset") && args.includes("json"));
      const lockIndex = calls.findIndex(({ args }) => args.includes("create") && args.includes("-f"));
      const upgradeIndex = calls.findIndex(({ command, args }) => command === "helm" && args[0] === "upgrade");
      expect(readIndex).toBeGreaterThan(lockIndex);
      expect(readIndex).toBeLessThan(upgradeIndex);
      expect(planDeployment(root, "production", "v1.2.3", runner).planHash).toBe(plan.planHash);
      for (const { args } of calls.filter(({ args }) => args.includes("--dry-run=client"))) {
        expect(() => statSync(args[args.indexOf("-f") + 1]!)).toThrow();
      }
    });

    it("leaves a failed storage upgrade for deliberate recovery and releases the Lease", async () => {
      const root = storageProject();
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const { calls, runner } = deploymentRunner({
        helmVersion,
        storageResource: storageStatefulSet(`example.com/podokit-storage:v0.9.0@sha256:${"c".repeat(64)}`),
        failDependencyUpgrade: true,
      });
      const plan = planDeployment(root, "production", "v1.2.3", runner);

      await expect(applyDeployment(root, "production", "v1.2.3", plan.planHash, runner, successfulFetcher()))
        .rejects.toThrow("failed with status 1");

      const upgrades = calls.filter(({ command, args }) => command === "helm" && args[0] === "upgrade");
      expect(upgrades).toHaveLength(1);
      expect(upgrades[0]?.args).not.toContain(failureFlag);
      expect(calls.some(({ command, args }) => command === "helm" && args[0] === "rollback")).toBe(false);
      expect(calls.some(({ args }) => args.includes("apply") && args.some((entry) => entry.endsWith("migration.yaml")))).toBe(false);
      expect(calls.at(-1)?.args).toEqual(expect.arrayContaining(["delete", "lease"]));
    });

    it.each([
      ["unchanged managed image", "inCluster", {}],
      ["new managed installation", "inCluster", { dependencyMissing: true, storageMissing: true }],
      ["external object storage", "external", { storageReadFails: true }],
    ] satisfies Array<[string, "inCluster" | "external", RunnerOptions]>)("keeps existing Helm behavior for %s", async (_name, mode, options) => {
      const root = storageProject(mode);
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { calls, runner } = deploymentRunner({ helmVersion, ...options });
      const plan = planDeployment(root, "production", "v1.2.3", runner);

      await applyDeployment(root, "production", "v1.2.3", plan.planHash, runner, successfulFetcher());

      const upgrades = calls.filter(({ command, args }) => command === "helm" && args[0] === "upgrade");
      expect(upgrades).toHaveLength(2);
      expect(upgrades.every(({ args }) => args.includes(failureFlag))).toBe(true);
      expect(warning).not.toHaveBeenCalled();
      if (mode === "external") {
        expect(calls.some(({ args }) => args.includes("statefulset") && args.includes("json"))).toBe(false);
        expect(calls.some(({ command, args }) => command === "helm" && args.includes("manifest") && args.includes("example-app-dependencies"))).toBe(false);
      }
    });
  });

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
    expect(status.deployments[0]).toMatchObject({
      restartCount: 0,
      previousPods: { count: 0, restartCount: 0 },
    });
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

  describe("migration ledger", () => {
    function migrationJob(condition: Record<string, string>, completionTime?: string): unknown {
      return {
        spec: {
          template: {
            spec: {
              containers: [{
                name: "migrate",
                image: `example-api:v1.2.3@sha256:${"b".repeat(64)}`,
                command: ["bun", "run", "migrate:all"],
              }],
            },
          },
        },
        status: {
          startTime: "2026-10-19T07:38:08Z",
          ...(completionTime ? { completionTime } : {}),
          conditions: [{ status: "True", lastTransitionTime: "2026-10-19T07:38:14Z", ...condition }],
        },
      };
    }

    function ledger(entries: number): string {
      return JSON.stringify({
        data: {
          "migrations.json": JSON.stringify({
            schemaVersion: 1,
            entries: Array.from({ length: entries }, (_, index) => ({
              release: `v1.0.${index}`,
              job: `example-app-migrate-v1-0-${index}`,
              image: "example-api:v1.0.0",
              command: ["bun", "run", "migrate:all"],
              startedAt: null,
              finishedAt: null,
              result: "succeeded",
            })),
          }),
        },
      });
    }

    function writtenEntries(write: unknown): Array<Record<string, unknown>> {
      const configMap = write as { metadata: { name: string }; data: Record<string, string> };
      expect(configMap.metadata.name).toBe("example-app-migrations");
      return (JSON.parse(configMap.data["migrations.json"]!) as { entries: Array<Record<string, unknown>> }).entries;
    }

    it("records a finished migration in a ConfigMap that outlives the Job", async () => {
      const root = initializedProject();
      const { calls, ledgerWrites, runner } = deploymentRunner({
        migrationJob: migrationJob({ type: "Complete" }, "2026-10-19T07:38:14Z"),
        migrationLedger: ledger(20),
      });
      const plan = planDeployment(root, "production", "v1.2.3", runner);

      const status = await applyDeployment(root, "production", "v1.2.3", plan.planHash, runner, successfulFetcher());

      expect(ledgerWrites).toHaveLength(1);
      const entries = writtenEntries(ledgerWrites[0]);
      expect(entries).toHaveLength(20);
      expect(entries[0]?.release).toBe("v1.0.1");
      expect(entries.at(-1)).toEqual({
        release: "v1.2.3",
        job: "example-app-migrate-v1-2-3",
        image: `example-api:v1.2.3@sha256:${"b".repeat(64)}`,
        command: ["bun", "run", "migrate:all"],
        startedAt: "2026-10-19T07:38:08Z",
        finishedAt: "2026-10-19T07:38:14Z",
        result: "succeeded",
      });
      const ledgerWrite = calls.findIndex(({ args }) => args.includes("--server-side"));
      const applicationUpgrade = calls.findIndex(
        ({ command, args }) => command === "helm" && args[0] === "upgrade" && args[2] === "example-app",
      );
      expect(ledgerWrite).toBeGreaterThan(calls.findIndex(({ args }) => args.includes("wait")));
      expect(applicationUpgrade).toBeGreaterThan(ledgerWrite);
      // The runner answers status with the ledger as it was before this apply.
      expect(status.lastMigration?.release).toBe("v1.0.19");
    });

    it("stops at a failed migration within one wait and reports its pod's log without credentials", async () => {
      const root = initializedProject();
      const { calls, ledgerWrites, runner } = deploymentRunner({
        failMigrationWait: true,
        migrationJob: migrationJob({ type: "Failed", reason: "BackoffLimitExceeded", message: "Job has reached the specified backoff limit" }),
        migrationPods: [
          { metadata: { name: "example-app-migrate-v1-2-3-old", creationTimestamp: "2026-10-19T07:38:00Z" } },
          { metadata: { name: "example-app-migrate-v1-2-3-new", creationTimestamp: "2026-10-19T07:38:08Z" } },
        ],
        migrationLogs: [
          "connecting to postgres://app:hunter2@db:5432/app",
          "DB_PASSWORD=hunter2 API_TOKEN: 'abc def'",
          "",
          "migration 0042 failed: relation \"users\" does not exist",
        ].join("\n"),
      });
      const plan = planDeployment(root, "production", "v1.2.3", runner);

      const failure = await applyDeployment(root, "production", "v1.2.3", plan.planHash, runner, successfulFetcher())
        .then(() => null, (error: Error) => error);

      expect(failure?.message).toBe(
        "Migration Job example-app-migrate-v1-2-3 failed: BackoffLimitExceeded: Job has reached the specified backoff limit.\n" +
          "Last log lines of pod example-app-migrate-v1-2-3-new:\n" +
          "  connecting to postgres://app:***@db:5432/app\n" +
          "  DB_PASSWORD=*** API_TOKEN: ***\n" +
          "  migration 0042 failed: relation \"users\" does not exist",
      );
      expect(failure?.message).not.toContain("hunter2");
      const waits = calls.filter(({ args }) => args.includes("wait") && args.some((entry) => entry.startsWith("job/")));
      expect(waits).toHaveLength(1);
      expect(waits[0]?.args).toContain("--timeout=5s");
      expect(calls.some(({ args }) => args.includes("logs") && args.includes("example-app-migrate-v1-2-3-new"))).toBe(true);
      expect(writtenEntries(ledgerWrites[0])).toEqual([
        expect.objectContaining({
          release: "v1.2.3",
          finishedAt: "2026-10-19T07:38:14Z",
          result: "failed",
          reason: "BackoffLimitExceeded: Job has reached the specified backoff limit",
        }),
      ]);
      expect(calls.some(({ command, args }) => command === "helm" && args[2] === "example-app")).toBe(false);
      expect(calls.at(-1)?.args).toEqual(expect.arrayContaining(["delete", "lease"]));
    });

    it("gives up on a migration that never finishes after the 10-minute budget of short waits", async () => {
      const root = initializedProject();
      const { calls, ledgerWrites, runner } = deploymentRunner({
        failMigrationWait: true,
        migrationJob: { spec: {}, status: { startTime: "2026-10-19T07:38:08Z", active: 1 } },
        migrationPods: [{
          metadata: { name: "example-app-migrate-v1-2-3-abcde", creationTimestamp: "2026-10-19T07:38:08Z" },
          status: { containerStatuses: [{ state: { waiting: { reason: "ImagePullBackOff", message: "Back-off pulling image" } } }] },
        }],
      });
      const plan = planDeployment(root, "production", "v1.2.3", runner);

      await expect(applyDeployment(root, "production", "v1.2.3", plan.planHash, runner, successfulFetcher()))
        .rejects.toThrow(
          "Migration Job example-app-migrate-v1-2-3 did not finish within 10 minutes; its pod is waiting: " +
            "ImagePullBackOff: Back-off pulling image. Inspect it with kubectl -n example-app describe job example-app-migrate-v1-2-3.\n" +
            "Pod example-app-migrate-v1-2-3-abcde printed no log lines.",
        );

      expect(calls.filter(({ args }) => args.includes("wait") && args.some((entry) => entry.startsWith("job/"))))
        .toHaveLength(120);
      expect(writtenEntries(ledgerWrites[0])).toEqual([
        expect.objectContaining({
          image: `ghcr.io/example/example-app-api:v1.2.3@sha256:${"b".repeat(64)}`,
          command: ["bun", "run", "migrate:all"],
          startedAt: "2026-10-19T07:38:08Z",
          finishedAt: null,
          result: "incomplete",
          reason: "the Job was still running when apply stopped waiting",
        }),
      ]);
    });

    it("warns and keeps deploying when the ledger cannot be written", async () => {
      const root = initializedProject();
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { calls, runner } = deploymentRunner({
        migrationJob: migrationJob({ type: "Complete" }, "2026-10-19T07:38:14Z"),
        failLedgerWrite: true,
      });
      const plan = planDeployment(root, "production", "v1.2.3", runner);

      await applyDeployment(root, "production", "v1.2.3", plan.planHash, runner, successfulFetcher());

      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining("The migration succeeded could not be recorded in ConfigMap example-app-migrations"),
      );
      expect(calls.some(({ command, args }) => command === "helm" && args[2] === "example-app")).toBe(true);
    });
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
