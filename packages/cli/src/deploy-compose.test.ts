import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CommandRunner } from "./dev";
import { APP_PROXY_TIMEOUTS_PATH, NO_APP_PROXY_TIMEOUTS } from "./app-proxy-timeouts";
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
  getComposeStatus,
  inspectComposeEndpointFingerprint,
  planComposeDeployment,
} from "./deploy-compose";
import { loadAnyDeploymentProfile, readDeploymentDriver } from "./deploy-driver";
import { profilePath } from "./deploy-schema";
import { initLockfile, readManifest, writeManifest } from "./lockfile";
import { resolveToolchain } from "./toolchain";

const created: string[] = [];
const API_DIGEST = `sha256:${"1".repeat(64)}`;
const WEB_DIGEST = `sha256:${"2".repeat(64)}`;
const POSTGRES_DIGEST = `sha256:${"3".repeat(64)}`;
const GATEWAY_DIGEST = `sha256:${"4".repeat(64)}`;

function project(modules: string[] = ["auth"]): string {
  const root = mkdtempSync(join(tmpdir(), "podokit-compose-"));
  created.push(root);
  mkdirSync(join(root, "apps", "api"), { recursive: true });
  initLockfile(root, {
    template: "fullstack",
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
  it("uses available S3-compatible server and client images", () => {
    const profile = initializeComposeProfile(project(), "production", {
      context: "production",
      endpointFingerprint: `sha256:${"b".repeat(64)}`,
      host: "app.example.com",
    }).profile;
    expect(profile.dependencies.objectStorage.image).toBe("pgsty/silo:RELEASE.2026-09-16T00-00-00Z");
    expect(profile.dependencies.objectStorage.clientImage).toBe("pgsty/mc:RELEASE.2026-09-16T00-00-00Z");
    // A reverse proxy on the host is the expected front door; the proxy settings follow from it.
    expect(profile.exposure.edgeProxies).toBe(1);
    for (const key of ["ADDRESS_HEADER", "XFF_DEPTH", "TRUSTED_PROXY_HOPS", "TRUSTED_PROXY_HEADER"]) {
      expect(profile.runtimeConfig).not.toHaveProperty(key);
    }
  });

  it("turns the audit log on when the audit-log module is installed", () => {
    expect(composeProfileOf(initialized(["auth", "audit-log"])).runtimeConfig.AUDIT_LOG_ENABLED).toBe("true");
    expect(composeProfileOf(initialized(["auth"])).runtimeConfig).not.toHaveProperty("AUDIT_LOG_ENABLED");
  });

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
    expect(profile.exposure.webSocketPaths).toEqual([]);
    expect(profile.exposure.apiPaths).toEqual([]);
    expect(profile.exposure.trustedProxyCidrs).toEqual([]);
  });

  it.each<[unknown, string]>([
    [["/api/"], "static path prefixes under /api/"],
    [["/api/files/*"], "static path prefixes under /api/"],
    [["/api/auth/"], "authentication routes"],
    [["/api/files/", "/api/files/uploads/"], "overlapping paths"],
  ])("rejects unsafe API path configuration %#", (apiPaths, message) => {
    const root = initialized();
    const file = profilePath(root, "production");
    const value = JSON.parse(readFileSync(file, "utf8")) as {
      exposure: { apiPaths: unknown };
    };
    value.exposure.apiPaths = apiPaths;
    writeFileSync(file, JSON.stringify(value));
    expect(() => loadAnyDeploymentProfile(root, "production")).toThrow(message);
  });

  it("accepts trusted proxy CIDRs when only API paths enable the gateway", () => {
    const root = initialized();
    const file = profilePath(root, "production");
    const value = JSON.parse(readFileSync(file, "utf8")) as {
      exposure: { apiPaths: string[]; trustedProxyCidrs: string[] };
    };
    value.exposure.apiPaths = ["/api/files/uploads/"];
    value.exposure.trustedProxyCidrs = ["127.0.0.1/32"];
    writeFileSync(file, JSON.stringify(value));
    const profile = loadAnyDeploymentProfile(root, "production");
    expect(profile.exposure.apiPaths).toEqual(["/api/files/uploads/"]);
  });

  it.each<[string[], string]>([
    [["/"], "static absolute paths"],
    [["/events/*"], "static absolute paths"],
    [["/events/ws", "/events/ws"], "duplicate path"],
  ])("rejects unsafe WebSocket path configuration %#", (webSocketPaths, message) => {
    const root = initialized();
    const file = profilePath(root, "production");
    const value = JSON.parse(readFileSync(file, "utf8")) as {
      exposure: { webSocketPaths: string[] };
    };
    value.exposure.webSocketPaths = webSocketPaths;
    writeFileSync(file, JSON.stringify(value));
    expect(() => loadAnyDeploymentProfile(root, "production")).toThrow(message);
  });

  it.each<[unknown, string]>([
    [["127.0.0.1"], "IP CIDR block"],
    [["127.0.0.1/33"], "IP CIDR block"],
    [["::1/129"], "IP CIDR block"],
    [["127.0.0.1/32", "127.0.0.1/32"], "duplicate CIDR blocks"],
  ])("rejects unsafe trusted proxy configuration %#", (trustedProxyCidrs, message) => {
    const root = initialized();
    const file = profilePath(root, "production");
    const value = JSON.parse(readFileSync(file, "utf8")) as {
      exposure: { trustedProxyCidrs: unknown; webSocketPaths: string[] };
    };
    value.exposure.webSocketPaths = ["/events/ws"];
    value.exposure.trustedProxyCidrs = trustedProxyCidrs;
    writeFileSync(file, JSON.stringify(value));
    expect(() => loadAnyDeploymentProfile(root, "production")).toThrow(message);
  });

  it("accepts trusted proxy CIDRs without direct routes, since the gateway always runs", () => {
    const root = initialized();
    const file = profilePath(root, "production");
    const value = JSON.parse(readFileSync(file, "utf8")) as {
      exposure: { trustedProxyCidrs: string[] };
    };
    value.exposure.trustedProxyCidrs = ["127.0.0.1/32"];
    writeFileSync(file, JSON.stringify(value));
    expect(loadAnyDeploymentProfile(root, "production").exposure.trustedProxyCidrs).toEqual(["127.0.0.1/32"]);
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

  it("uses a single API replica and no managed dependencies for local providers", () => {
    const root = initialized([]);
    const manifestPath = join(root, ".podokit", "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      providers: Record<string, string>;
    };
    manifest.providers = {
      database: "sqlite",
      cache: "memory",
      "object-storage": "local",
      events: "memory",
      jobs: "local",
    };
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const profile = initializeComposeProfile(root, "local", {
      context: "local",
      endpointFingerprint: `sha256:${"b".repeat(64)}`,
    }).profile;
    expect(profile.workloads.api.replicas).toBe(1);
    expect(profile.workloads.worker).toBeNull();
    expect(profile.dependencies.postgres.mode).toBe("disabled");
    expect(profile.dependencies.redis.mode).toBe("disabled");
    expect(profile.dependencies.objectStorage.mode).toBe("disabled");
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

function writeProxyTimeouts(root: string, entries: string): void {
  const path = join(root, APP_PROXY_TIMEOUTS_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `export const APP_PROXY_TIMEOUTS: ReadonlyArray<{ pathPrefix: string; timeoutMs: number | null }> = [\n${entries}\n];\n`,
  );
}

function composeProfileOf(root: string) {
  const profile = loadAnyDeploymentProfile(root, "production");
  if (profile.driver !== "docker-compose") throw new Error("expected docker-compose profile");
  return profile;
}

describe("compose rendering", () => {
  it("publishes only a transparent gateway, on the configured bind address, without direct routes", () => {
    const profile = composeProfileOf(initialized());
    const document = renderComposeDocument(
      profile,
      "v1.2.3",
      defaultComposeImages(profile, "v1.2.3"),
      "sha256:0",
      NO_APP_PROXY_TIMEOUTS,
    );
    const web = document.split("example-app-web:")[1]?.split("example-app-gateway:")[0] ?? "";
    const gateway = document.split("example-app-gateway:")[1] ?? "";
    expect(web).not.toContain("ports:");
    expect(gateway).toContain('"127.0.0.1:8080:3000"');
    expect(document.match(/ports:/g)).toHaveLength(1);
    // Every peer is trusted and appended to X-Forwarded-For, as an Ingress does,
    // so the web server counts the gateway as one more hop.
    expect(gateway).toContain("trusted_proxies static 0.0.0.0/0 ::/0");
    expect(gateway).not.toContain("trusted_proxies_strict");
    expect(gateway).not.toContain("header_up");
    expect(gateway).toContain("  handle {\\n    reverse_proxy example-app-web:3000\\n  }\\n");
    expect(document).toContain("XFF_DEPTH: \"2\"");
  });

  it("resolves the client at the gateway once trusted proxy CIDRs are listed", () => {
    const profile = composeProfileOf(initialized());
    profile.exposure.trustedProxyCidrs = ["10.0.0.0/8"];
    const document = renderComposeDocument(
      profile,
      "v1.2.3",
      defaultComposeImages(profile, "v1.2.3"),
      "sha256:0",
      NO_APP_PROXY_TIMEOUTS,
    );
    const web = document.split("example-app-web:")[1]?.split("example-app-gateway:")[0] ?? "";
    const gateway = document.split("example-app-gateway:")[1] ?? "";
    expect(gateway).toContain("trusted_proxies static 10.0.0.0/8");
    expect(gateway).toContain("header_up X-Forwarded-For {client_ip}");
    expect(document).toContain("XFF_DEPTH: \"1\"");
  });

  it("routes exact WebSocket paths to API through the published gateway", () => {
    const profile = composeProfileOf(initialized());
    profile.exposure.webSocketPaths = ["/agent/ws", "/terminal/ws"];
    profile.exposure.trustedProxyCidrs = ["127.0.0.1/32", "::1/128"];
    const images = {
      ...defaultComposeImages(profile, "v1.2.3"),
      gateway: `caddy:2.10-alpine@${GATEWAY_DIGEST}`,
    };
    const document = renderComposeDocument(profile, "v1.2.3", images, "sha256:0", NO_APP_PROXY_TIMEOUTS);
    const web = document.split("example-app-web:")[1]?.split("example-app-gateway:")[0] ?? "";
    const gateway = document.split("example-app-gateway:")[1] ?? "";

    expect(web).not.toContain("ports:");
    expect(gateway).toContain(`caddy:2.10-alpine@${GATEWAY_DIGEST}`);
    expect(gateway).toContain("path /agent/ws /terminal/ws");
    expect(gateway).toContain("trusted_proxies static 127.0.0.1/32 ::1/128");
    expect(gateway).toContain("trusted_proxies_strict");
    // Web and API each get the one address Caddy resolved from the trusted
    // chain, never "client, proxy", so one trusted hop finds the client.
    const forwardOne = "header_up X-Forwarded-For {client_ip}\\n";
    expect(gateway).toContain(`reverse_proxy example-app-api:3000 {\\n      ${forwardOne}    }`);
    expect(gateway).toContain(`reverse_proxy example-app-web:3000 {\\n      ${forwardOne}    }`);
    expect(gateway.split(forwardOne)).toHaveLength(3);
    expect(gateway).toContain('"127.0.0.1:8080:3000"');
    expect(document.match(/ports:/g)).toHaveLength(1);
  });

  it("routes API paths to API without /api through the published gateway", () => {
    const profile = composeProfileOf(initialized());
    profile.exposure.apiPaths = ["/api/files/uploads/", "/api/imports"];
    const images = {
      ...defaultComposeImages(profile, "v1.2.3"),
      gateway: `caddy:2.10-alpine@${GATEWAY_DIGEST}`,
    };
    const document = renderComposeDocument(profile, "v1.2.3", images, "sha256:0", NO_APP_PROXY_TIMEOUTS);
    const web = document.split("example-app-web:")[1]?.split("example-app-gateway:")[0] ?? "";
    const gateway = document.split("example-app-gateway:")[1] ?? "";

    expect(web).not.toContain("ports:");
    expect(gateway).toContain(
      "  @api_paths path /api/files/uploads /api/files/uploads/* /api/imports /api/imports/*\\n" +
        "  handle @api_paths {\\n" +
        "    uri strip_prefix /api\\n" +
        "    reverse_proxy example-app-api:3000 {\\n" +
        "      header_up X-Forwarded-For {client_ip}\\n" +
        "    }\\n" +
        "  }\\n" +
        "  handle {\\n" +
        "    reverse_proxy example-app-web:3000 {\\n" +
        "      header_up X-Forwarded-For {client_ip}\\n",
    );
    expect(gateway).not.toContain("@api_websockets");
    expect(gateway).toContain('"127.0.0.1:8080:3000"');
    expect(document.match(/ports:/g)).toHaveLength(1);
  });

  it("keeps WebSocket paths unprefixed next to API paths", () => {
    const profile = composeProfileOf(initialized());
    profile.exposure.webSocketPaths = ["/events/ws"];
    profile.exposure.apiPaths = ["/api/files/uploads/"];
    const images = {
      ...defaultComposeImages(profile, "v1.2.3"),
      gateway: `caddy:2.10-alpine@${GATEWAY_DIGEST}`,
    };
    const gateway =
      renderComposeDocument(profile, "v1.2.3", images, "sha256:0", NO_APP_PROXY_TIMEOUTS).split("example-app-gateway:")[1] ?? "";

    expect(gateway).toContain(
      "  @api_websockets path /events/ws\\n  handle @api_websockets {\\n" +
        "    reverse_proxy example-app-api:3000 {\\n      header_up X-Forwarded-For {client_ip}\\n    }\\n" +
        "  }\\n  @api_paths",
    );
  });

  it("runs workers with Bun", () => {
    const root = initialized(["auth", "bullmq"]);
    const profile = composeProfileOf(root);
    const document = renderComposeDocument(
      profile,
      "v1.2.3",
      defaultComposeImages(profile, "v1.2.3"),
      "sha256:0",
      NO_APP_PROXY_TIMEOUTS,
    );

    expect(document).toContain('command: ["bun", "dist/main-worker.js"]');
  });

  it("declares data volumes external so a compose down cannot delete them", () => {
    const profile = composeProfileOf(initialized());
    const document = renderComposeDocument(
      profile,
      "v1.2.3",
      defaultComposeImages(profile, "v1.2.3"),
      "sha256:0",
      NO_APP_PROXY_TIMEOUTS,
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
      NO_APP_PROXY_TIMEOUTS,
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
    const document = renderMigrationDocument(profile, "v1.2.3", images, NO_APP_PROXY_TIMEOUTS);
    expect(document).toContain(`repo/api@${API_DIGEST}`);
    expect(document).toContain('command: ["bun", "run", "migrate:all"]');
    expect(document).toContain("external: true");
  });

  it("uses Bun for the default migration in a Bun project", () => {
    const root = initialized();
    const manifest = readManifest(root);
    if (!manifest) throw new Error("expected manifest");
    writeManifest(root, { ...manifest, toolchain: resolveToolchain("bun") });
    const profile = composeProfileOf(root);
    const runtime = renderComposeDeployment(root, "production", profile, "v1.2.3");

    expect(runtime.migrationDocument).toContain('command: ["bun", "run", "migrate:all"]');
  });

  it("changes the rollout state when an env file changes", () => {
    const profile = composeProfileOf(initialized());
    const before = rolloutStateDigest(profile, { api: "aaa" }, NO_APP_PROXY_TIMEOUTS);
    const after = rolloutStateDigest(profile, { api: "bbb" }, NO_APP_PROXY_TIMEOUTS);
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
      const digest = line.includes("caddy")
        ? GATEWAY_DIGEST
        : line.includes("-web")
          ? WEB_DIGEST
          : line.includes("postgres")
            ? POSTGRES_DIGEST
            : API_DIGEST;
      return reply(JSON.stringify({ digest }));
    }
    if (line.includes("sha256sum")) return reply(`${"f".repeat(64)}\n`);
    if (line.includes("releases.json")) return reply("");
    if (line.includes("compose -f") && line.includes("ps")) return reply("");
    if (line.includes("ADMIN_EMAILS=")) return reply("");
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

  it("reads only the ADMIN_EMAILS line of the API env file and fails on a placeholder", () => {
    const root = initialized();
    const finding = (stdout: string) => {
      const findings = doctorComposeDeployment(root, "production", scriptedRunner({ "ADMIN_EMAILS=": stdout }));
      return findings.find((entry) => entry.code === "admin-emails");
    };
    const calls: string[] = [];
    const recording: CommandRunner = (command, args) => {
      calls.push(`${command} ${args.join(" ")}`);
      return scriptedRunner({ "ADMIN_EMAILS=": "ops@company.io\n" })(command, args);
    };
    expect(
      doctorComposeDeployment(root, "production", recording).find((entry) => entry.code === "admin-emails"),
    ).toMatchObject({ ok: true, message: "ADMIN_EMAILS in /etc/podokit/example-app/api.env lists 1 administrator address." });
    const read = calls.find((call) => call.includes("ADMIN_EMAILS="));
    // A throwaway container without a network mounts the file read-only and prints that one line.
    expect(read).toContain("run --rm --network none --user 0:0 -v /etc/podokit/example-app/api.env:/podokit-env:ro");
    expect(read).toContain("sed -n 's/^[[:space:]]*ADMIN_EMAILS=//p' /podokit-env");

    // Over SSH the deploying user reads the file in place.
    calls.length = 0;
    const overSsh = scriptedRunner({ "{{.Endpoints.docker.Host}}": "ssh://deploy@host\n", "ADMIN_EMAILS=": "ops@company.io\n" });
    const viaSsh = doctorComposeDeployment(root, "production", (command, args) => {
      calls.push(`${command} ${args.join(" ")}`);
      return overSsh(command, args);
    });
    expect(viaSsh.find((entry) => entry.code === "admin-emails")?.ok).toBe(true);
    expect(calls).toContain("ssh deploy@host sed -n 's/^[[:space:]]*ADMIN_EMAILS=//p' /etc/podokit/example-app/api.env");

    expect(finding('"admin@example.com"\n')).toMatchObject({ ok: false });
    expect(finding('"admin@example.com"\n')?.message).toContain(
      "ADMIN_EMAILS in /etc/podokit/example-app/api.env lists admin@example.com (a placeholder",
    );
    // Docker Compose applies the last assignment.
    expect(finding("admin@example.com\nowner@company.io\n")?.ok).toBe(true);
    expect(finding("owner@company.io\nadmin@example.com\n")?.ok).toBe(false);
    expect(finding("")?.message).toContain("does not set ADMIN_EMAILS");

    const failing: CommandRunner = (command, args) =>
      `${command} ${args.join(" ")}`.includes("ADMIN_EMAILS=")
        ? { status: 1, stdout: "", stderr: "Permission denied" }
        : scriptedRunner()(command, args);
    const unreadable = doctorComposeDeployment(root, "production", failing).find((entry) => entry.code === "admin-emails");
    expect(unreadable).toMatchObject({ ok: false });
    expect(unreadable?.message).toContain("Cannot read ADMIN_EMAILS from /etc/podokit/example-app/api.env");

    // Without the auth module nothing reads ADMIN_EMAILS.
    expect(
      doctorComposeDeployment(initialized([]), "production", scriptedRunner({ "ADMIN_EMAILS=": "admin@example.com\n" }))
        .some((entry) => entry.code === "admin-emails"),
    ).toBe(false);
  });

  it("warns, without failing, when a profile does not turn the audit log on", () => {
    const root = initialized(["auth", "audit-log"]);
    const auditFinding = () =>
      doctorComposeDeployment(root, "production", scriptedRunner()).find((finding) => finding.code === "audit-log");
    expect(auditFinding()).toMatchObject({ ok: true });
    expect(auditFinding()?.warning).toBeUndefined();

    const file = profilePath(root, "production");
    const value = JSON.parse(readFileSync(file, "utf8")) as { runtimeConfig: Record<string, string> };
    value.runtimeConfig.AUDIT_LOG_ENABLED = "false";
    writeFileSync(file, JSON.stringify(value));
    expect(auditFinding()).toMatchObject({ ok: true, warning: true });
    expect(auditFinding()?.message).toContain('AUDIT_LOG_ENABLED is "false"');

    delete value.runtimeConfig.AUDIT_LOG_ENABLED;
    writeFileSync(file, JSON.stringify(value));
    expect(auditFinding()).toMatchObject({ ok: true, warning: true });
    expect(auditFinding()?.message).toContain("does not set AUDIT_LOG_ENABLED");

    // Without the module there is nothing to record, so nothing to report.
    expect(
      doctorComposeDeployment(initialized(["auth"]), "production", scriptedRunner())
        .some((finding) => finding.code === "audit-log"),
    ).toBe(false);
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

  it("pins the gateway image when WebSocket routing is enabled", () => {
    const root = initialized();
    const file = profilePath(root, "production");
    const value = JSON.parse(readFileSync(file, "utf8")) as {
      exposure: { webSocketPaths: string[] };
    };
    value.exposure.webSocketPaths = ["/agent/ws"];
    writeFileSync(file, JSON.stringify(value));

    const plan = planComposeDeployment(root, "production", "v1.2.3", scriptedRunner());

    expect(plan.images.gateway).toBe(`caddy:2.10-alpine@${GATEWAY_DIGEST}`);
  });

  it("pins the gateway image and names the direct routes for API paths", () => {
    const root = initialized();
    const file = profilePath(root, "production");
    const value = JSON.parse(readFileSync(file, "utf8")) as {
      exposure: { apiPaths: string[] };
    };
    const first = planComposeDeployment(root, "production", "v1.2.3", scriptedRunner());
    value.exposure.apiPaths = ["/api/files/uploads/"];
    writeFileSync(file, JSON.stringify(value));

    const plan = planComposeDeployment(root, "production", "v1.2.3", scriptedRunner());

    expect(first.images.gateway).toBe(`caddy:2.10-alpine@${GATEWAY_DIGEST}`);
    expect(plan.images.gateway).toBe(`caddy:2.10-alpine@${GATEWAY_DIGEST}`);
    expect(plan.actions.find((action) => action.kind === "application")?.description).toBe(
      "Start the new api and web beside the running containers and wait for health, then stop the old containers; " +
        "the gateway is replaced only when its definition changes. Route /api/files/uploads/ directly to the API without /api.",
    );
    expect(plan.planHash).not.toBe(first.planHash);
  });

  it("warns once that the published port moves from web to the gateway", () => {
    const root = initialized();
    const ps = (services: string[]) =>
      services.map((service) => JSON.stringify({ Service: `example-app-${service}`, Name: `example-app-${service}-1` })).join("\n");
    const moving = planComposeDeployment(root, "production", "v1.2.3", scriptedRunner({ " ps --format json": ps(["api", "web"]) }));
    expect(moving.warnings.join(" ")).toContain("moves port 8080 from web to the gateway");
    const moved = planComposeDeployment(
      root,
      "production",
      "v1.2.3",
      scriptedRunner({ " ps --format json": ps(["api", "web", "gateway"]) }),
    );
    expect(moved.warnings.join(" ")).not.toContain("to the gateway");
    const first = planComposeDeployment(root, "production", "v1.2.3", scriptedRunner());
    expect(first.warnings.join(" ")).not.toContain("to the gateway");
  });

  it("warns when the deployment can open more PostgreSQL connections than the server allows", () => {
    const root = initialized(["auth", "bullmq"]);
    const file = profilePath(root, "production");
    const value = JSON.parse(readFileSync(file, "utf8")) as {
      workloads: { api: { replicas: number } };
      dependencies: { postgres: { maxConnections?: number } };
    };
    // One API and one worker process, and the new API beside the old during a rollout: 3 x 31 of 97.
    value.workloads.api.replicas = 1;
    writeFileSync(file, JSON.stringify(value));
    expect(planComposeDeployment(root, "production", "v1.2.3", scriptedRunner()).warnings.join(" ")).not.toContain(
      "PostgreSQL connections",
    );
    value.dependencies.postgres.maxConnections = 95;
    writeFileSync(file, JSON.stringify(value));
    expect(planComposeDeployment(root, "production", "v1.2.3", scriptedRunner()).warnings).toContain(
      "PostgreSQL connections can reach 93, above the 92 that max_connections 95 leaves after 3 reserved: " +
        "each API or worker process holds up to 31 (DB_POOL_MAX 20 + 1 + DB_AUTH_POOL_MAX 10); 2 process(es) hold 62, " +
        "3 during a rollout, counting old API containers that have not stopped, hold 93, " +
        "and the migration adds 2 to the 62. Lower DB_POOL_MAX or DB_AUTH_POOL_MAX in runtimeConfig, run fewer replicas, " +
        "or raise dependencies.postgres.maxConnections.",
    );
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

  it("produces a different hash when the trusted proxy boundary changes", () => {
    const root = initialized();
    const file = profilePath(root, "production");
    const value = JSON.parse(readFileSync(file, "utf8")) as {
      exposure: { trustedProxyCidrs: string[]; webSocketPaths: string[] };
    };
    value.exposure.webSocketPaths = ["/events/ws"];
    writeFileSync(file, JSON.stringify(value));
    const first = planComposeDeployment(root, "production", "v1.2.3", scriptedRunner());

    value.exposure.trustedProxyCidrs = ["127.0.0.1/32"];
    writeFileSync(file, JSON.stringify(value));
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

describe("api service", () => {
  it("bounds the readiness healthcheck above the API's check timeout", () => {
    const profile = composeProfileOf(initialized(["auth"]));
    const document = renderComposeDocument(
      profile,
      "v1.2.3",
      defaultComposeImages(profile, "v1.2.3"),
      "sha256:0",
      NO_APP_PROXY_TIMEOUTS,
    );
    const api = document.split("\n  example-app-api:\n")[1]?.split(/\n  \S/)[0] ?? "";
    expect(api).toContain("/health/ready");
    expect(api).toContain("  timeout: 5s\n");
  });
});

describe("web service", () => {
  it("checks the web server's own health route, not a page that calls the API", () => {
    const profile = composeProfileOf(initialized(["auth"]));
    const document = renderComposeDocument(
      profile,
      "v1.2.3",
      defaultComposeImages(profile, "v1.2.3"),
      "sha256:0",
      NO_APP_PROXY_TIMEOUTS,
    );
    const web = document.split("\n  example-app-web:\n")[1]?.split(/\n  \S/)[0] ?? "";
    expect(web).toContain("fetch('http://127.0.0.1:3000/healthz')");
    expect(web).toContain("  timeout: 5s\n");
  });

  it("keeps a silent connection open past the proxy deadline, as the profile sets it", () => {
    const profile = composeProfileOf(initialized(["auth"]));
    const serviceOf = (document: string, role: string): string =>
      document.split(`\n  example-app-${role}:\n`)[1]?.split(/\n  \S/)[0] ?? "";
    const render = (): string =>
      renderComposeDocument(profile, "v1.2.3", defaultComposeImages(profile, "v1.2.3"), "sha256:0", NO_APP_PROXY_TIMEOUTS);
    for (const role of ["web", "api"]) {
      expect(serviceOf(render(), role)).toContain('      CONNECTION_IDLE_TIMEOUT: "35"\n');
      expect(serviceOf(render(), role)).toContain('      API_IDLE_TIMEOUT: "35"\n');
    }
    profile.runtimeConfig = { ...profile.runtimeConfig, BACKEND_PROXY_TIMEOUT_MS: "120000" };
    expect(serviceOf(render(), "web")).toContain('      CONNECTION_IDLE_TIMEOUT: "125"\n');
    expect(serviceOf(render(), "api")).toContain('      API_IDLE_TIMEOUT: "125"\n');
    profile.runtimeConfig = { ...profile.runtimeConfig, BACKEND_PROXY_TIMEOUT_MS: "300000" };
    expect(render).toThrow('set CONNECTION_IDLE_TIMEOUT to "0"');
    profile.runtimeConfig = { ...profile.runtimeConfig, CONNECTION_IDLE_TIMEOUT: "0", API_IDLE_TIMEOUT: "0" };
    expect(serviceOf(render(), "web")).toContain('      CONNECTION_IDLE_TIMEOUT: "0"\n');
    expect(serviceOf(render(), "api")).toContain('      API_IDLE_TIMEOUT: "0"\n');
  });
});

describe("stop grace period", () => {
  const serviceOf = (document: string, service: string): string =>
    document.split(`\n  example-app-${service}:\n`)[1]?.split(/\n  \S/)[0] ?? "";

  function everyService() {
    const profile = composeProfileOf(initialized(["auth", "bullmq", "object-storage-s3"]));
    profile.exposure.webSocketPaths = ["/agent/ws"];
    return profile;
  }

  function render(profile: ReturnType<typeof composeProfileOf>): string {
    return renderComposeDocument(
      profile,
      "v1.2.3",
      { ...defaultComposeImages(profile, "v1.2.3"), gateway: `caddy:2.10-alpine@${GATEWAY_DIGEST}` },
      "sha256:0",
      NO_APP_PROXY_TIMEOUTS,
    );
  }

  it("lets the API and web server drain like on Kubernetes, and the worker keep 30 s", () => {
    const document = render(everyService());
    expect(serviceOf(document, "api")).toContain("\n    stop_grace_period: 35s\n");
    expect(serviceOf(document, "web")).toContain("\n    stop_grace_period: 35s\n");
    expect(serviceOf(document, "worker")).toContain("\n    stop_grace_period: 30s\n");
  });

  it("follows SHUTDOWN_TIMEOUT from the profile", () => {
    const profile = everyService();
    profile.runtimeConfig = { ...profile.runtimeConfig, SHUTDOWN_TIMEOUT: "120" };
    const document = render(profile);
    expect(serviceOf(document, "api")).toContain("\n    stop_grace_period: 125s\n");
    expect(serviceOf(document, "web")).toContain("\n    stop_grace_period: 125s\n");
    expect(serviceOf(document, "worker")).toContain("\n    stop_grace_period: 30s\n");
  });

  it("leaves dependencies and the gateway as they were, so an upgrade does not recreate them", () => {
    const document = render(everyService());
    for (const service of ["postgres", "redis", "object-storage", "object-storage-init", "gateway"]) {
      const block = serviceOf(document, service);
      expect(block, service).toContain("image:");
      expect(block, service).not.toContain("stop_grace_period");
    }
  });
});

describe("compose status", () => {
  it("names each service's containers, which side-by-side rollouts renumber", () => {
    const root = initialized(["auth"]);
    const psEntry = (name: string, service: string) =>
      JSON.stringify({ Name: name, Service: service, Image: `${service}:v1.2.3`, State: "running" });
    const runner = scriptedRunner({
      "ps --format json": [
        psEntry("example-app-api-10", "example-app-api"),
        psEntry("example-app-web-2", "example-app-web"),
        psEntry("example-app-api-9", "example-app-api"),
        psEntry("example-app-postgres-1", "example-app-postgres"),
      ].join("\n"),
      " inspect ": JSON.stringify({ Image: "sha256:abc", RestartCount: 0, State: { Status: "running" } }),
    });
    const status = getComposeStatus(root, "production", runner);
    const service = (name: string) => status.services.find((entry) => entry.name === name);
    expect(service("example-app-api")).toMatchObject({
      containers: ["example-app-api-9", "example-app-api-10"],
      running: 2,
      desired: 2,
    });
    expect(service("example-app-web")?.containers).toEqual(["example-app-web-2"]);
    expect(service("example-app-postgres")?.containers).toEqual(["example-app-postgres-1"]);
  });
});

describe("application proxy deadlines", () => {
  const environmentOf = (document: string, role: string): string =>
    document.split(`\n  example-app-${role}:\n`)[1]?.split(/\n  \S/)[0] ?? "";

  it("turns both idle timeouts off for a route without a deadline", () => {
    const root = initialized(["auth"]);
    writeProxyTimeouts(root, '  { pathPrefix: "/api/hosts/:hostId/file-transfers", timeoutMs: null },');
    const runtime = renderComposeDeployment(root, "production", composeProfileOf(root), "v1.2.3");
    for (const role of ["web", "api"]) {
      expect(environmentOf(runtime.composeDocument, role)).toContain('      CONNECTION_IDLE_TIMEOUT: "0"\n');
      expect(environmentOf(runtime.composeDocument, role)).toContain('      API_IDLE_TIMEOUT: "0"\n');
    }
    expect(runtime.migrationDocument).toContain('      CONNECTION_IDLE_TIMEOUT: "0"\n');
  });

  it("outlasts the longest deadline, and never shortens the default", () => {
    const root = initialized(["auth"]);
    writeProxyTimeouts(
      root,
      '  { pathPrefix: "/api/exports/", timeoutMs: 120_000 },\n  { pathPrefix: "/api/quick/", timeoutMs: 5_000 },',
    );
    const render = () => renderComposeDeployment(root, "production", composeProfileOf(root), "v1.2.3");
    expect(environmentOf(render().composeDocument, "web")).toContain('      CONNECTION_IDLE_TIMEOUT: "125"\n');
    expect(environmentOf(render().composeDocument, "api")).toContain('      API_IDLE_TIMEOUT: "125"\n');

    writeProxyTimeouts(root, '  { pathPrefix: "/api/quick/", timeoutMs: 5_000 },');
    expect(environmentOf(render().composeDocument, "web")).toContain('      CONNECTION_IDLE_TIMEOUT: "35"\n');

    writeProxyTimeouts(root, '  { pathPrefix: "/api/exports/", timeoutMs: 251_000 },');
    expect(render).toThrow(
      'The /api proxy waits up to 251000 ms (APP_PROXY_TIMEOUTS entry /api/exports/), longer than the longest idle timeout (255 seconds); set CONNECTION_IDLE_TIMEOUT to "0" to turn it off.',
    );
  });

  it("keeps idle timeouts the profile sets", () => {
    const root = initialized(["auth"]);
    writeProxyTimeouts(root, '  { pathPrefix: "/api/hosts/:hostId/file-transfers", timeoutMs: null },');
    const file = profilePath(root, "production");
    const value = JSON.parse(readFileSync(file, "utf8")) as { runtimeConfig: Record<string, string> };
    value.runtimeConfig.API_IDLE_TIMEOUT = "35";
    writeFileSync(file, JSON.stringify(value));
    const document = renderComposeDeployment(root, "production", composeProfileOf(root), "v1.2.3").composeDocument;
    expect(environmentOf(document, "api")).toContain('      API_IDLE_TIMEOUT: "35"\n');
    expect(environmentOf(document, "api")).toContain('      CONNECTION_IDLE_TIMEOUT: "0"\n');
  });

  it("fails the plan when it cannot read the deadlines it needs", () => {
    const root = initialized(["auth"]);
    writeProxyTimeouts(root, "  ...SHARED_TIMEOUTS,");
    expect(() => planComposeDeployment(root, "production", "v1.2.3", scriptedRunner())).toThrow(
      "Cannot read APP_PROXY_TIMEOUTS from apps/web/src/lib/server/proxy-timeouts.ts without running it",
    );

    const file = profilePath(root, "production");
    const value = JSON.parse(readFileSync(file, "utf8")) as { runtimeConfig: Record<string, string> };
    value.runtimeConfig.CONNECTION_IDLE_TIMEOUT = "0";
    value.runtimeConfig.API_IDLE_TIMEOUT = "0";
    writeFileSync(file, JSON.stringify(value));
    expect(planComposeDeployment(root, "production", "v1.2.3", scriptedRunner()).planHash).toMatch(/^sha256:/);
  });

  it("changes the plan hash when an application deadline changes", () => {
    const root = initialized(["auth"]);
    const first = planComposeDeployment(root, "production", "v1.2.3", scriptedRunner());
    writeProxyTimeouts(root, '  { pathPrefix: "/api/hosts/:hostId/file-transfers", timeoutMs: null },');
    const second = planComposeDeployment(root, "production", "v1.2.3", scriptedRunner());
    expect(second.planHash).not.toBe(first.planHash);
    expect(second.rolloutStateDigest).not.toBe(first.rolloutStateDigest);
  });

  it("checks idle timeouts the profile sets against the deadlines in the doctor", () => {
    const root = initialized(["auth"]);
    const finding = () =>
      doctorComposeDeployment(root, "production", scriptedRunner()).find((entry) => entry.code === "idle-timeouts");
    expect(finding()).toMatchObject({ ok: true });
    expect(finding()?.warning).toBeUndefined();
    expect(finding()?.message).toContain("CONNECTION_IDLE_TIMEOUT 35 and API_IDLE_TIMEOUT 35");

    writeProxyTimeouts(root, '  { pathPrefix: "/api/hosts/:hostId/file-transfers", timeoutMs: null },');
    expect(finding()?.message).toContain(
      "CONNECTION_IDLE_TIMEOUT 0 and API_IDLE_TIMEOUT 0 outlast the /api proxy's longest wait (no deadline, APP_PROXY_TIMEOUTS entry /api/hosts/:hostId/file-transfers)",
    );

    const file = profilePath(root, "production");
    const value = JSON.parse(readFileSync(file, "utf8")) as { runtimeConfig: Record<string, string> };
    value.runtimeConfig.API_IDLE_TIMEOUT = "35";
    writeFileSync(file, JSON.stringify(value));
    expect(finding()).toMatchObject({ ok: true, warning: true });
    expect(finding()?.message).toContain('API_IDLE_TIMEOUT "35" closes a silent connection');

    value.runtimeConfig.CONNECTION_IDLE_TIMEOUT = "35";
    writeFileSync(file, JSON.stringify(value));
    expect(finding()).toMatchObject({ ok: false });
    expect(finding()?.message).toContain("so the web server refuses to start");

    writeProxyTimeouts(root, "  ...SHARED_TIMEOUTS,");
    expect(finding()).toMatchObject({ ok: true, warning: true });
    expect(finding()?.message).toContain("The idle timeouts were not checked.");
    delete value.runtimeConfig.API_IDLE_TIMEOUT;
    writeFileSync(file, JSON.stringify(value));
    expect(finding()).toMatchObject({ ok: false });
    expect(finding()?.message).toContain("Cannot read APP_PROXY_TIMEOUTS");
  });
});

describe("worker service", () => {
  it("disables the healthcheck it would inherit from the API image", () => {
    const profile = composeProfileOf(initialized(["auth", "bullmq"]));
    const document = renderComposeDocument(
      profile,
      "v1.2.3",
      defaultComposeImages(profile, "v1.2.3"),
      "sha256:0",
      NO_APP_PROXY_TIMEOUTS,
    );
    const worker = document.split("example-app-worker:")[1] ?? "";
    // The API image declares an HTTP healthcheck; a worker has no HTTP server, so
    // inheriting it means permanently unhealthy.
    expect(worker).toContain("healthcheck:\n      disable: true");
    expect(worker).not.toContain("/health/ready");
  });
});

describe("object storage init", () => {
  it("writes the policy it attaches", () => {
    const profile = composeProfileOf(initialized(["auth", "object-storage-s3"]));
    const document = renderComposeDocument(
      profile,
      "v1.2.3",
      defaultComposeImages(profile, "v1.2.3"),
      "sha256:0",
      NO_APP_PROXY_TIMEOUTS,
    );
    // Referencing a policy file the job never creates leaves the application user
    // with no permissions, and the only symptom is a readiness check that is down.
    expect(document).toContain("podokit-policy.json");
    expect(document).toContain("arn:aws:s3:::app/*");
    expect(document).not.toContain(" /policy.json");
  });
});

describe("published port and replicas", () => {
  it("initializes the web service with a single replica", () => {
    const profile = composeProfileOf(initialized());
    expect(profile.workloads.web.replicas).toBe(1);
  });

  it("refuses more than one replica of the service that publishes the port", () => {
    const root = initialized();
    const file = profilePath(root, "production");
    const value = JSON.parse(readFileSync(file, "utf8")) as {
      workloads: { web: { replicas: number } };
    };
    value.workloads.web.replicas = 2;
    writeFileSync(file, JSON.stringify(value));
    // Compose cannot share a host port, so the second replica fails to bind and
    // takes the rollout down with it.
    expect(() => loadAnyDeploymentProfile(root, "production")).toThrow(
      "workloads.web.replicas must be 1",
    );
  });
});
