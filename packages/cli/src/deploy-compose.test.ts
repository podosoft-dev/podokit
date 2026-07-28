import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CommandRunner } from "./dev";
import { initializeComposeProfile, parseComposeProfile } from "./deploy-compose-profile";
import {
  defaultComposeImages,
  renderComposeDeployment,
  renderComposeDocument,
  renderMigrationDocument,
  rolloutStateDigest,
} from "./deploy-compose-render";
import {
  applyComposeDeployment,
  doctorComposeDeployment,
  inspectComposeEndpointFingerprint,
  planComposeDeployment,
} from "./deploy-compose";
import { loadAnyDeploymentProfile, readDeploymentDriver } from "./deploy-driver";
import { profilePath } from "./deploy-schema";
import { initLockfile } from "./lockfile";

const created: string[] = [];
const API_DIGEST = `sha256:${"1".repeat(64)}`;
const WEB_DIGEST = `sha256:${"2".repeat(64)}`;
const POSTGRES_DIGEST = `sha256:${"3".repeat(64)}`;

function project(modules: string[] = ["auth"]): string {
  const root = mkdtempSync(join(tmpdir(), "podokit-compose-"));
  created.push(root);
  mkdirSync(join(root, "apps", "api"), { recursive: true });
  initLockfile(root, {
    template: "fullstack-nest-svelte",
    packageManager: "npm",
    answers: { projectName: "example-app" },
    version: "0.16.4",
  });
  const manifestPath = join(root, ".podokit", "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    modules: Array<{ name: string; addedWith: string }>;
  };
  manifest.modules = modules.map((name) => ({ name, addedWith: "0.16.4" }));
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return root;
}

function initialized(modules?: string[]): string {
  const root = project(modules);
  initializeComposeProfile(root, "production", {
    context: "production",
    // The same value `podo deploy init` would record, so the doctor's fingerprint
    // check compares like with like instead of against a hand-written constant.
    endpointFingerprint: inspectComposeEndpointFingerprint("production", scriptedRunner()),
    host: "app.example.com",
  });
  return root;
}

afterEach(() => {
  for (const directory of created.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("docker-compose profile", () => {
  it("records the driver so dispatch reads it back from disk", () => {
    const root = initialized();
    expect(readDeploymentDriver(root, "production")).toBe("docker-compose");
    expect(loadAnyDeploymentProfile(root, "production").driver).toBe("docker-compose");
  });

  it("binds the published port to loopback by default", () => {
    const profile = loadAnyDeploymentProfile(initialized(), "production");
    expect(profile.driver).toBe("docker-compose");
    if (profile.driver !== "docker-compose") return;
    expect(profile.exposure.bindAddress).toBe("127.0.0.1");
  });

  it("enables Redis and a worker only when a module needs them", () => {
    const plain = loadAnyDeploymentProfile(initialized(["auth"]), "production");
    const queued = loadAnyDeploymentProfile(initialized(["auth", "bullmq"]), "production");
    if (plain.driver !== "docker-compose" || queued.driver !== "docker-compose") {
      throw new Error("expected docker-compose profiles");
    }
    expect(plain.dependencies.redis.mode).toBe("disabled");
    expect(plain.workloads.worker).toBeNull();
    expect(queued.dependencies.redis.mode).toBe("managed");
    expect(queued.workloads.worker).not.toBeNull();
  });

  it.each<[string, string]>([
    ["etc/podokit/api.env", "must be an absolute path"],
    ["/etc/podokit/../../api.env", "must be an absolute path"],
  ])("rejects an env file path that is not absolute and contained: %s", (path, message) => {
    const root = initialized();
    const file = profilePath(root, "production");
    const value = JSON.parse(readFileSync(file, "utf8")) as {
      secrets: { api: { path: string } };
    };
    value.secrets.api.path = path;
    writeFileSync(file, JSON.stringify(value));
    expect(() => loadAnyDeploymentProfile(root, "production")).toThrow(message);
  });

  it("refuses a runtime config key that could carry a credential", () => {
    const root = initialized();
    const file = profilePath(root, "production");
    const value = JSON.parse(readFileSync(file, "utf8")) as {
      runtimeConfig: Record<string, string>;
    };
    value.runtimeConfig.DATABASE_PASSWORD = "hunter2";
    writeFileSync(file, JSON.stringify(value));
    expect(() => loadAnyDeploymentProfile(root, "production")).toThrow("may contain a secret");
  });

  it("refuses a bind address that is not an IPv4 literal", () => {
    const root = initialized();
    const file = profilePath(root, "production");
    const value = JSON.parse(readFileSync(file, "utf8")) as {
      exposure: { bindAddress: string };
    };
    value.exposure.bindAddress = "0.0.0.0.0";
    writeFileSync(file, JSON.stringify(value));
    expect(() => loadAnyDeploymentProfile(root, "production")).toThrow(
      "must be an IPv4 address",
    );
  });
});

function composeProfileOf(root: string) {
  const profile = loadAnyDeploymentProfile(root, "production");
  if (profile.driver !== "docker-compose") throw new Error("expected docker-compose profile");
  return profile;
}

describe("compose rendering", () => {
  it("publishes only the web service, on the configured bind address", () => {
    const profile = composeProfileOf(initialized());
    const document = renderComposeDocument(
      profile,
      "v1.2.3",
      defaultComposeImages(profile, "v1.2.3"),
      "sha256:0",
    );
    expect(document).toContain('"127.0.0.1:8080:3000"');
    expect(document.match(/ports:/g)).toHaveLength(1);
  });

  it("declares data volumes external so a compose down cannot delete them", () => {
    const profile = composeProfileOf(initialized());
    const document = renderComposeDocument(
      profile,
      "v1.2.3",
      defaultComposeImages(profile, "v1.2.3"),
      "sha256:0",
    );
    expect(document).toContain("example-app-postgres:\n    external: true");
  });

  it("references env files by path and never inlines a value", () => {
    const profile = composeProfileOf(initialized());
    const document = renderComposeDocument(
      profile,
      "v1.2.3",
      defaultComposeImages(profile, "v1.2.3"),
      "sha256:0",
    );
    expect(document).toContain("/etc/podokit/example-app/api.env");
    // Every dependency credential arrives through env_file, so no key name that the
    // profile lists as secret may appear as an inline environment entry.
    for (const key of ["POSTGRES_PASSWORD", "BETTER_AUTH_SECRET", "REDIS_PASSWORD"]) {
      expect(document).not.toContain(`${key}: `);
    }
  });

  it("runs the migration from the API image on the application network", () => {
    const profile = composeProfileOf(initialized());
    const images = { ...defaultComposeImages(profile, "v1.2.3"), api: `repo/api@${API_DIGEST}` };
    const document = renderMigrationDocument(profile, "v1.2.3", images);
    expect(document).toContain(`repo/api@${API_DIGEST}`);
    expect(document).toContain('command: ["npm", "run", "migrate:all"]');
    expect(document).toContain("external: true");
  });

  it("changes the rollout state when an env file changes", () => {
    const profile = composeProfileOf(initialized());
    const before = rolloutStateDigest(profile, { api: "aaa" });
    const after = rolloutStateDigest(profile, { api: "bbb" });
    expect(before).not.toBe(after);
  });

  it("is deterministic for the same inputs", () => {
    const root = initialized();
    const profile = composeProfileOf(root);
    const images = defaultComposeImages(profile, "v1.2.3");
    const first = renderComposeDeployment(root, "production", profile, "v1.2.3", images, "sha256:0");
    const second = renderComposeDeployment(root, "production", profile, "v1.2.3", images, "sha256:0");
    expect(first.composeDocument).toBe(second.composeDocument);
  });
});

/** A runner that answers the exact docker invocations the driver makes. */
function scriptedRunner(overrides: Record<string, string> = {}): CommandRunner {
  return (command, args) => {
    const line = `${command} ${args.join(" ")}`;
    const reply = (stdout: string) => ({ status: 0, stdout, stderr: "" });
    for (const [needle, stdout] of Object.entries(overrides)) {
      if (line.includes(needle)) return reply(stdout);
    }
    if (line.includes("compose version")) return reply("2.31.0\n");
    if (line.includes("buildx version")) return reply("github.com/docker/buildx v0.20.0\n");
    if (line.includes("context inspect")) {
      return reply(JSON.stringify({ Name: "production", Endpoints: { docker: { Host: "ssh://podo@host" } } }));
    }
    if (line.includes("info --format")) return reply("DAEMONID\n");
    if (line.includes("imagetools inspect")) {
      const digest = line.includes("-web") ? WEB_DIGEST : line.includes("postgres") ? POSTGRES_DIGEST : API_DIGEST;
      return reply(JSON.stringify({ digest }));
    }
    if (line.includes("sha256sum")) return reply(`${"f".repeat(64)}\n`);
    if (line.includes("releases.json")) return reply("");
    if (line.includes("compose -f") && line.includes("ps")) return reply("");
    if (line.includes("sed -n")) {
      return reply(["BETTER_AUTH_SECRET", "POSTGRES_DB", "POSTGRES_PASSWORD", "POSTGRES_USER"].join("\n"));
    }
    return reply("");
  };
}

describe("compose doctor", () => {
  it("fails closed when the endpoint fingerprint does not match", () => {
    const root = initialized();
    const findings = doctorComposeDeployment(
      root,
      "production",
      scriptedRunner({ "info --format": "OTHERDAEMON\n" }),
    );
    const fingerprint = findings.find((finding) => finding.code === "endpoint-fingerprint");
    expect(fingerprint?.ok).toBe(false);
    // Nothing after the fingerprint check should run against the wrong host.
    expect(findings.some((finding) => finding.code.startsWith("env-file"))).toBe(false);
  });

  it("reports the API env file keys a managed dependency requires", () => {
    const root = initialized();
    const findings = doctorComposeDeployment(
      root,
      "production",
      scriptedRunner({ "sed -n": "BETTER_AUTH_SECRET\n" }),
    );
    const api = findings.find((finding) => finding.code === "env-file-api");
    expect(api?.ok).toBe(false);
    expect(api?.message).toContain("POSTGRES_PASSWORD");
  });

  it("passes when every required key is present", () => {
    const findings = doctorComposeDeployment(initialized(), "production", scriptedRunner());
    expect(findings.filter((finding) => !finding.ok)).toEqual([]);
  });
});

describe("compose plan", () => {
  it("pins every image to a digest and warns about migration ordering", () => {
    const root = initialized();
    const plan = planComposeDeployment(root, "production", "v1.2.3", scriptedRunner());
    expect(plan.images.api).toContain(`@${API_DIGEST}`);
    expect(plan.images.web).toContain(`@${WEB_DIGEST}`);
    expect(plan.warnings.join(" ")).toContain("compatible with the release currently serving");
  });

  it("rejects a release tag that is not a stable SemVer tag", () => {
    const root = initialized();
    expect(() => planComposeDeployment(root, "production", "latest", scriptedRunner())).toThrow(
      "does not match deployment tag pattern",
    );
  });

  it("refuses to apply without the exact plan hash, and changes nothing first", async () => {
    const root = initialized();
    const attempted: string[] = [];
    const recording: CommandRunner = (command, args, options) => {
      attempted.push(`${command} ${args.join(" ")}`);
      return scriptedRunner()(command, args, options);
    };

    await expect(
      applyComposeDeployment(root, "production", "v1.2.3", "sha256:wrong", recording),
    ).rejects.toThrow("Confirmation hash does not match");

    // Planning reads; it must not have created a volume, started a service, or
    // taken the deployment lock on the way to rejecting the hash.
    expect(attempted.filter((line) => line.includes("volume create"))).toEqual([]);
    expect(attempted.filter((line) => line.includes("up -d"))).toEqual([]);
    expect(attempted.filter((line) => line.includes("deploy.lock"))).toEqual([]);
  });

  it("produces a different hash when the profile changes", () => {
    const root = initialized();
    const first = planComposeDeployment(root, "production", "v1.2.3", scriptedRunner());
    const file = profilePath(root, "production");
    const value = JSON.parse(readFileSync(file, "utf8")) as { exposure: { port: number } };
    value.exposure.port = 9090;
    writeFileSync(file, JSON.stringify(parseComposeProfile(value)));
    const second = planComposeDeployment(root, "production", "v1.2.3", scriptedRunner());
    expect(first.planHash).not.toBe(second.planHash);
  });
});
// Appended to deploy-compose.test.ts: a plan must stay confirmable while the
// target is flapping, which is exactly when a deployment is most needed.

describe("plan stability", () => {
  it("keeps the same hash while container status churns", () => {
    const root = initialized();
    const psLine = (status: string, restarts: number) =>
      JSON.stringify({
        Name: "example-app-api-1",
        Service: "example-app-api",
        Image: "repo/api@sha256:abc",
        State: status,
        Health: status === "running" ? "healthy" : "starting",
        Status: `Restarting (${restarts}) ${restarts} seconds ago`,
      });

    const first = planComposeDeployment(
      root,
      "production",
      "v1.2.3",
      scriptedRunner({ "ps --format json": psLine("restarting", 3) }),
    );
    const second = planComposeDeployment(
      root,
      "production",
      "v1.2.3",
      scriptedRunner({ "ps --format json": psLine("restarting", 47) }),
    );
    expect(second.planHash).toBe(first.planHash);
  });

  it("changes the hash when a different image is deployed", () => {
    const root = initialized();
    const psLine = (image: string) =>
      JSON.stringify({ Service: "example-app-api", Image: image, State: "running" });
    const first = planComposeDeployment(
      root,
      "production",
      "v1.2.3",
      scriptedRunner({ "ps --format json": psLine("repo/api@sha256:abc") }),
    );
    const second = planComposeDeployment(
      root,
      "production",
      "v1.2.3",
      scriptedRunner({ "ps --format json": psLine("repo/api@sha256:def") }),
    );
    expect(second.planHash).not.toBe(first.planHash);
  });
});
