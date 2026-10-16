import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { connectionBudget, connectionBudgetWarning, installedModules, profileFindings } from "./deploy-checks";
import { initializeComposeProfile } from "./deploy-compose-profile";
import { renderComposeDeployment } from "./deploy-compose-render";
import { loadAnyDeploymentProfile, type AnyDeployProfile } from "./deploy-driver";
import { initializeDeploymentProfile } from "./deploy-profile";
import { renderDeployment } from "./deploy-render";
import { profilePath } from "./deploy-schema";
import { initLockfile } from "./lockfile";

const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function project(driver: "kubernetes-helm" | "docker-compose", modules: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "podokit-checks-"));
  created.push(root);
  mkdirSync(join(root, "apps", "api"), { recursive: true });
  initLockfile(root, { template: "fullstack", answers: { projectName: "example-app" }, version: "1.5.0" });
  const manifestPath = join(root, ".podokit", "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { modules: unknown[] };
  manifest.modules = modules.map((name, order) => ({ name, order, addedWith: "1.5.0" }));
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const fingerprint = `sha256:${"a".repeat(64)}`;
  if (driver === "kubernetes-helm") {
    initializeDeploymentProfile(root, "production", { context: "production", clusterFingerprint: fingerprint });
  } else {
    initializeComposeProfile(root, "production", { context: "production", endpointFingerprint: fingerprint });
  }
  return root;
}

function edit(root: string, change: (profile: Record<string, any>) => void): AnyDeployProfile {
  const path = profilePath(root, "production");
  const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
  change(value);
  writeFileSync(path, JSON.stringify(value));
  return loadAnyDeploymentProfile(root, "production");
}

function budgetFinding(root: string) {
  return profileFindings(root, loadAnyDeploymentProfile(root, "production")).find(
    (finding) => finding.code === "database-connections",
  );
}

describe("PostgreSQL connection budget", () => {
  it("counts every API and worker process with full pools, and Kubernetes' surge pods", () => {
    const root = project("kubernetes-helm", ["auth"]);
    const budget = connectionBudget(loadAnyDeploymentProfile(root, "production"), installedModules(root));
    expect(budget).toMatchObject({
      maxConnections: 100,
      available: 97,
      perProcess: 31,
      perProcessTerms: ["DB_POOL_MAX 20 + 1", "DB_AUTH_POOL_MAX 10"],
      steady: 62,
      rolloutProcesses: 3,
      rollout: 93,
      peak: 93,
    });
    expect(budgetFinding(root)).toMatchObject({ ok: true });
    expect(budgetFinding(root)?.warning).toBeUndefined();
  });

  it("warns when a Kubernetes rollout can exceed max_connections, and fails when steady state does", () => {
    const root = project("kubernetes-helm", ["auth", "bullmq"]);
    // Two API and one worker pod, plus a surge pod for each during a rollout: 5 x 31.
    expect(budgetFinding(root)).toMatchObject({ ok: true, warning: true });
    expect(budgetFinding(root)?.message).toContain("can reach 155 during a deployment");
    expect(connectionBudgetWarning(loadAnyDeploymentProfile(root, "production"), installedModules(root))).toContain(
      "PostgreSQL connections can reach 155, above the 97 that max_connections 100 leaves after 3 reserved",
    );

    edit(root, (profile) => {
      profile.workloads.api.replicas = 3;
    });
    expect(budgetFinding(root)).toMatchObject({ ok: false });
    expect(budgetFinding(root)?.message).toContain("exceed the limit even between rollouts");

    edit(root, (profile) => {
      profile.dependencies.postgres.maxConnections = 200;
    });
    expect(budgetFinding(root)).toMatchObject({ ok: true });
    expect(budgetFinding(root)?.message).toContain("max_connections 200 leaves 197");
  });

  it("counts application pools the profile names, as a release-config check would", () => {
    const root = project("kubernetes-helm", ["auth"]);
    const profile = edit(root, (value) => {
      Object.assign(value.runtimeConfig, { DB_POOL_MAX: "10", SDD_DB_POOL_MAX: "10" });
      value.dependencies.postgres.appPools = [{ sizeKey: "SDD_DB_POOL_MAX", extraConnections: 1 }];
    });
    // (2 replicas + 1 surge) x (10 + 1 + 10 + 10 + 1) = 96 of 97.
    expect(connectionBudget(profile, installedModules(root))).toMatchObject({ perProcess: 32, peak: 96 });
    expect(budgetFinding(root)?.warning).toBeUndefined();
    edit(root, (value) => {
      value.workloads.api.replicas = 3;
    });
    expect(budgetFinding(root)).toMatchObject({ ok: true, warning: true });
  });

  it("adds the migration but no surge for Compose", () => {
    const root = project("docker-compose", ["auth", "bullmq"]);
    const budget = connectionBudget(loadAnyDeploymentProfile(root, "production"), installedModules(root));
    // Compose replaces containers one at a time; the migration runs beside the old ones.
    expect(budget).toMatchObject({ steady: 93, rollout: 93, migration: 2, peak: 95 });
    expect(budgetFinding(root)?.warning).toBeUndefined();
    edit(root, (value) => {
      value.dependencies.postgres.maxConnections = 97;
    });
    expect(budgetFinding(root)).toMatchObject({ ok: true, warning: true });
  });

  it("skips a deployment without PostgreSQL and fails pool sizes it cannot read", () => {
    const root = project("docker-compose", ["auth"]);
    edit(root, (value) => {
      value.dependencies.postgres.mode = "disabled";
    });
    expect(budgetFinding(root)).toBeUndefined();
    edit(root, (value) => {
      value.dependencies.postgres.mode = "external";
      value.runtimeConfig.DB_POOL_MAX = "twenty";
    });
    expect(budgetFinding(root)).toMatchObject({ ok: false });
    expect(budgetFinding(root)?.message).toContain('DB_POOL_MAX "twenty" is not a positive integer');
  });

  it.each<[Record<string, unknown>, Record<string, string>, string]>([
    [{ maxConnections: 2 }, {}, "must be an integer from 4 to 262143"],
    [{ appPools: [{ sizeKey: "SDD_DB_POOL_MAX" }] }, {}, "which runtimeConfig must set to a positive integer"],
    [{ appPools: [{ sizeKey: "DB_POOL_MAX" }] }, {}, "DB_POOL_MAX and DB_AUTH_POOL_MAX are counted already"],
    [
      { appPools: [{ sizeKey: "SDD_DB_POOL_MAX", extraConnections: -1 }] },
      { SDD_DB_POOL_MAX: "10" },
      "must be a non-negative integer",
    ],
    [
      { appPools: [{ sizeKey: "SDD_DB_POOL_MAX", size: 10 }] },
      { SDD_DB_POOL_MAX: "10" },
      "contains unknown key(s): size",
    ],
  ])("rejects a budget setting it cannot use %#", (postgres, runtimeConfig, message) => {
    for (const driver of ["kubernetes-helm", "docker-compose"] as const) {
      const root = project(driver, ["auth"]);
      expect(() =>
        edit(root, (value) => {
          Object.assign(value.runtimeConfig, runtimeConfig);
          Object.assign(value.dependencies.postgres, postgres);
        }),
      ).toThrow(message);
    }
  });

  it("sets max_connections on a PostgreSQL server PodoKit runs, only when the profile asks", () => {
    const kubernetes = project("kubernetes-helm", ["auth"]);
    const compose = project("docker-compose", ["auth"]);
    const kubernetesDependencies = () =>
      renderDeployment(kubernetes, "production", loadAnyDeploymentProfile(kubernetes, "production") as never, "v1.2.3")
        .dependencyManifest;
    const composeDocument = () =>
      renderComposeDeployment(compose, "production", loadAnyDeploymentProfile(compose, "production") as never, "v1.2.3")
        .composeDocument;
    expect(kubernetesDependencies()).not.toContain("max_connections");
    expect(composeDocument()).not.toContain("max_connections");
    for (const root of [kubernetes, compose]) {
      edit(root, (value) => {
        value.dependencies.postgres.maxConnections = 200;
      });
    }
    expect(kubernetesDependencies()).toContain('          args: ["-c", "max_connections=200"]\n          env:');
    expect(composeDocument()).toContain('    command: ["-c", "max_connections=200"]\n');
  });
});

function renderedEnvironment(root: string): Record<string, string> {
  const profile = loadAnyDeploymentProfile(root, "production");
  if (profile.driver === "kubernetes-helm") {
    const configMap = renderDeployment(root, "production", profile, "v1.2.3").applicationManifest.split("\n---\n")[0]!;
    return Object.fromEntries(
      [...configMap.matchAll(/^ {2}([A-Z_]+): "(.*)"$/gm)].map((match) => [match[1]!, match[2]!]),
    );
  }
  const web =
    renderComposeDeployment(root, "production", profile, "v1.2.3").composeDocument
      .split("\n  example-app-web:\n")[1]
      ?.split(/\n  \S/)[0] ?? "";
  return Object.fromEntries([...web.matchAll(/^ {6}([A-Z_]+): "(.*)"$/gm)].map((match) => [match[1]!, match[2]!]));
}

function addressSettings(root: string): Record<string, string | undefined> {
  const environment = renderedEnvironment(root);
  return Object.fromEntries(
    ["PROTOCOL_HEADER", "HOST_HEADER", "ADDRESS_HEADER", "XFF_DEPTH", "TRUSTED_PROXY_HOPS", "TRUSTED_PROXY_HEADER"].map(
      (key) => [key, environment[key]],
    ),
  );
}

function addressFinding(root: string) {
  return profileFindings(root, loadAnyDeploymentProfile(root, "production")).find(
    (finding) => finding.code === "client-address",
  );
}

const trusting = (depth: number) => ({
  PROTOCOL_HEADER: "x-forwarded-proto",
  HOST_HEADER: "x-forwarded-host",
  ADDRESS_HEADER: "x-forwarded-for",
  XFF_DEPTH: String(depth),
  TRUSTED_PROXY_HOPS: "1",
  TRUSTED_PROXY_HEADER: "x-forwarded-for",
});
// Without a proxy in front, every forwarded header is the client's own claim.
const ignoring = {
  PROTOCOL_HEADER: undefined,
  HOST_HEADER: undefined,
  ADDRESS_HEADER: undefined,
  XFF_DEPTH: undefined,
  TRUSTED_PROXY_HOPS: "1",
  TRUSTED_PROXY_HEADER: "x-forwarded-for",
};

describe("client address settings", () => {
  it("counts the Ingress controller on top of the edge proxies on Kubernetes", () => {
    const root = project("kubernetes-helm", ["auth"]);
    expect(addressSettings(root)).toEqual(trusting(1));
    edit(root, (value) => {
      value.exposure.edgeProxies = 1;
    });
    // Edge proxy, then Traefik: the web server reads the entry the edge proxy wrote.
    expect(addressSettings(root)).toEqual(trusting(2));
    expect(addressFinding(root)?.message).toContain("Traefik's forwardedHeaders.trustedIPs");
    edit(root, (value) => {
      value.exposure = { ...value.exposure, mode: "nodePort", edgeProxies: 0, apiPaths: [] };
    });
    expect(addressSettings(root)).toEqual(ignoring);
    expect(addressFinding(root)?.message).toContain("takes the client address from the connection");
  });

  it("trusts the edge proxies in front of the published web port, and one gateway hop", () => {
    const root = project("docker-compose", ["auth"]);
    expect(addressSettings(root)).toEqual(trusting(1));
    edit(root, (value) => {
      value.exposure.edgeProxies = 2;
    });
    expect(addressSettings(root)).toEqual(trusting(2));
    edit(root, (value) => {
      value.exposure.edgeProxies = 0;
    });
    expect(addressSettings(root)).toEqual(ignoring);
    edit(root, (value) => {
      value.exposure = { ...value.exposure, edgeProxies: 2, apiPaths: ["/api/files/uploads/"], trustedProxyCidrs: ["10.0.0.0/8"] };
    });
    // The gateway sends the one address it resolved, whatever stands in front of it.
    expect(addressSettings(root)).toEqual(trusting(1));
    expect(addressFinding(root)).toMatchObject({ ok: true });
    expect(addressFinding(root)?.warning).toBeUndefined();
  });

  it("warns when the trusted proxies contradict the topology", () => {
    const compose = project("docker-compose", ["auth"]);
    expect(addressFinding(compose)?.warning).toBeUndefined();
    edit(compose, (value) => {
      value.exposure.apiPaths = ["/api/files/uploads/"];
    });
    // A direct path starts the gateway, which trusts no proxy yet.
    expect(addressFinding(compose)).toMatchObject({ ok: true, warning: true });
    // It writes X-Forwarded-Proto for its own plain-HTTP listener then, so the web
    // server keeps its default origin rather than taking http.
    expect(addressSettings(compose)).toEqual({ ...trusting(1), PROTOCOL_HEADER: undefined, HOST_HEADER: undefined });
    expect(addressFinding(compose)?.message).toContain("exposure.trustedProxyCidrs is empty");
    edit(compose, (value) => {
      value.exposure = { ...value.exposure, edgeProxies: 0, trustedProxyCidrs: ["192.0.2.3/32"] };
    });
    expect(addressFinding(compose)?.message).toContain("but exposure.edgeProxies is 0");

    const kubernetes = project("kubernetes-helm", ["auth"]);
    edit(kubernetes, (value) => {
      value.exposure.apiPaths = ["/api/files/uploads/"];
    });
    expect(addressFinding(kubernetes)?.warning).toBeUndefined();
    edit(kubernetes, (value) => {
      value.exposure.edgeProxies = 1;
    });
    expect(addressFinding(kubernetes)).toMatchObject({ ok: true, warning: true });
    expect(addressFinding(kubernetes)?.message).toContain(
      "the Ingress forwards 2 addresses on /api/files/uploads/",
    );
  });

  it.each(["ADDRESS_HEADER", "XFF_DEPTH", "TRUSTED_PROXY_HOPS", "TRUSTED_PROXY_HEADER"])(
    "refuses %s in runtimeConfig and points at exposure.edgeProxies",
    (key) => {
      for (const driver of ["kubernetes-helm", "docker-compose"] as const) {
        const root = project(driver, ["auth"]);
        expect(() =>
          edit(root, (value) => {
            value.runtimeConfig[key] = "1";
          }),
        ).toThrow(`Deployment runtimeConfig key "${key}" is derived from exposure.edgeProxies`);
      }
    },
  );

  it.each([-1, 9, 1.5, "1"])("refuses edgeProxies %s", (edgeProxies) => {
    const root = project("docker-compose", ["auth"]);
    expect(() =>
      edit(root, (value) => {
        value.exposure.edgeProxies = edgeProxies;
      }),
    ).toThrow('"exposure.edgeProxies" must be an integer from 0 to 8');
  });
});
