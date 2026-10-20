import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CommandRunner } from "./dev";
import { initializeComposeProfile, parseComposeProfile } from "./deploy-compose-profile";
import { defaultComposeImages, renderComposeDocument } from "./deploy-compose-render";
import {
  applyComposeDeployment,
  inspectComposeEndpointFingerprint,
  planComposeDeployment,
} from "./deploy-compose";
import { NO_APP_PROXY_TIMEOUTS } from "./app-proxy-timeouts";
import { profilePath } from "./deploy-schema";
import { initLockfile } from "./lockfile";

const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, { recursive: true, force: true });
});

interface FakeContainer {
  id: string;
  service: string;
  running: boolean;
  hash: string;
}

/**
 * A Docker host that keeps the containers of one Compose project, so a test can
 * see which containers were running at every step of a rollout.
 */
class FakeHost {
  containers: FakeContainer[] = [];
  /** Every command, with the API and web containers running when it ran. */
  log: Array<{ line: string; running: string[] }> = [];
  failScaleOf: string | null = null;
  initStatus = 0;
  private next = 1;

  constructor(
    readonly project: string,
    readonly hashes: Record<string, string>,
  ) {}

  add(service: string, hash: string, running = true): string {
    const id = `c${String(this.next++).padStart(3, "0")}`;
    this.containers.push({ id, service, running, hash });
    return id;
  }

  running(service: string): string[] {
    return this.containers.filter((c) => c.service === service && c.running).map((c) => c.id);
  }

  runner(): CommandRunner {
    return (command, args) => {
      const line = `${command} ${args.join(" ")}`;
      this.log.push({
        line,
        running: this.containers.filter((c) => c.running).map((c) => `${c.service}:${c.hash}`),
      });
      const reply = (stdout: string, status = 0) => ({ status, stdout, stderr: status ? "failed" : "" });
      const service = (): string => {
        const match = /label=com\.docker\.compose\.service=(\S+)/.exec(line);
        return match?.[1] ?? "";
      };
      if (line.includes(" ps -a --filter")) {
        return reply(
          this.containers
            .filter((c) => c.service === service())
            .map((c) => `${c.id}\t${c.running ? "running" : "exited"}\t${c.hash}`)
            .join("\n"),
        );
      }
      const compose = /compose -f \S+ (.*)$/.exec(line)?.[1];
      if (compose !== undefined) {
        const hashOf = /^config --hash (\S+)$/.exec(compose);
        if (hashOf) return reply(`${hashOf[1]} ${this.hashes[hashOf[1] ?? ""] ?? "unknown"}\n`);
        const scale = /--scale (\S+)=(\d+) (\S+)$/.exec(compose);
        if (scale) {
          const [, name = "", count] = scale;
          if (this.failScaleOf === name) {
            this.add(name, this.hashes[name] ?? "", false);
            return reply("", 1);
          }
          while (this.containers.filter((c) => c.service === name).length < Number(count)) {
            this.add(name, this.hashes[name] ?? "");
          }
          return reply("");
        }
        const oneShot = /^up -d --no-deps (\S+)$/.exec(compose);
        if (oneShot) {
          this.containers = this.containers.filter((c) => c.service !== oneShot[1]);
          this.add(oneShot[1] ?? "", "init", false);
          return reply("");
        }
        const inPlace = /^up -d --no-deps --wait (\S+)$/.exec(compose);
        if (inPlace) {
          this.replaceInPlace(inPlace[1] ?? "");
          return reply("");
        }
        if (compose.startsWith("up -d --wait --remove-orphans")) {
          for (const name of Object.keys(this.hashes)) this.replaceInPlace(name);
          return reply("");
        }
        return reply("");
      }
      if (/--context \S+ wait \S+$/.test(line)) return reply(`${this.initStatus}\n`);
      const stop = /--context \S+ stop (.+)$/.exec(line);
      if (stop) {
        for (const id of (stop[1] ?? "").split(" ")) {
          const container = this.containers.find((c) => c.id === id);
          if (container) container.running = false;
        }
        return reply("");
      }
      const remove = /--context \S+ rm (?:-f )?(.+)$/.exec(line);
      if (remove) {
        const ids = (remove[1] ?? "").split(" ");
        this.containers = this.containers.filter((c) => !ids.includes(c.id));
        return reply("");
      }
      return scripted(command, args, { capture: true });
    };
  }

  /** What `compose up` does to a changed service: stop it, then start the replacement. */
  private replaceInPlace(service: string): void {
    const hash = this.hashes[service] ?? "";
    const current = this.containers.filter((c) => c.service === service);
    if (current.length && current.every((c) => c.running && c.hash === hash)) return;
    this.containers = this.containers.filter((c) => c.service !== service);
    this.add(service, hash);
  }
}

/** Answers the read-only invocations apply makes besides the rollout. */
const scripted: CommandRunner = (command, args) => {
  const line = `${command} ${args.join(" ")}`;
  const reply = (stdout: string) => ({ status: 0, stdout, stderr: "" });
  if (line.includes("compose version")) return reply("2.31.0\n");
  if (line.includes("buildx version")) return reply("github.com/docker/buildx v0.20.0\n");
  if (line.includes("context inspect")) {
    return reply(JSON.stringify({ Name: "production", Endpoints: { docker: { Host: "unix:///var/run/docker.sock" } } }));
  }
  if (line.includes("info --format")) return reply("DAEMONID\n");
  if (line.includes("imagetools inspect")) return reply(JSON.stringify({ digest: `sha256:${"1".repeat(64)}` }));
  if (line.includes("sha256sum")) return reply(`${"f".repeat(64)}\n`);
  if (line.includes("ADMIN_EMAILS=")) return reply("");
  if (line.includes("sed -n")) {
    return reply(
      [
        "BETTER_AUTH_SECRET",
        "MINIO_ROOT_PASSWORD",
        "MINIO_ROOT_USER",
        "POSTGRES_DB",
        "POSTGRES_PASSWORD",
        "POSTGRES_USER",
        "S3_ACCESS_KEY_ID",
        "S3_SECRET_ACCESS_KEY",
      ].join("\n"),
    );
  }
  return reply("");
};

function initialized(edit: (profile: Record<string, unknown>) => void = () => undefined): string {
  const root = mkdtempSync(join(tmpdir(), "podokit-compose-rollout-"));
  created.push(root);
  mkdirSync(join(root, "apps", "api"), { recursive: true });
  initLockfile(root, { template: "fullstack", answers: { projectName: "example-app" }, version: "0.16.4" });
  const manifestPath = join(root, ".podokit", "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { modules: unknown[] };
  manifest.modules = [{ name: "auth", addedWith: "0.16.4" }];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  initializeComposeProfile(root, "production", {
    context: "production",
    endpointFingerprint: inspectComposeEndpointFingerprint("production", scripted),
    host: "app.example.com",
  });
  const file = profilePath(root, "production");
  const profile = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  edit(profile);
  writeFileSync(file, JSON.stringify(profile));
  return root;
}

function withGateway(profile: Record<string, unknown>): void {
  (profile.exposure as { webSocketPaths: string[] }).webSocketPaths = ["/agent/ws"];
}

const fetcher: typeof fetch = async (input) => {
  const path = new URL(String(input)).pathname;
  return Response.json({ status: path.endsWith("/ready") ? "ready" : "ok" });
};

const API = "example-app-api";
const WEB = "example-app-web";
const GATEWAY = "example-app-gateway";

/** A host already running the previous release: two API replicas, web, and the gateway. */
function previousRelease(): FakeHost {
  const host = new FakeHost("example-app", { [API]: "api-new", [WEB]: "web-new", [GATEWAY]: "gateway" });
  host.add(API, "api-old");
  host.add(API, "api-old");
  host.add(WEB, "web-old");
  return host;
}

async function apply(root: string, host: FakeHost): Promise<void> {
  const hash = planComposeDeployment(root, "production", "v1.2.3", host.runner()).planHash;
  await applyComposeDeployment(root, "production", "v1.2.3", hash, host.runner(), fetcher);
}

function firstIndex(host: FakeHost, needle: string): number {
  return host.log.findIndex((entry) => entry.line.includes(needle));
}

describe("compose rollout", () => {
  it("keeps an API and a web server running at every step behind the gateway", async () => {
    const root = initialized(withGateway);
    const host = previousRelease();
    host.add(GATEWAY, "gateway");

    await apply(root, host);

    const rollout = host.log.slice(firstIndex(host, "run --rm --no-deps migrate"));
    for (const entry of rollout) {
      expect(entry.running.some((name) => name.startsWith(`${API}:`)), entry.line).toBe(true);
      expect(entry.running.some((name) => name.startsWith(`${WEB}:`)), entry.line).toBe(true);
    }
    // The gateway runs throughout: nothing replaced it.
    expect(host.log.every((entry) => entry.running.includes(`${GATEWAY}:gateway`))).toBe(true);
    // The new containers start beside the old ones, from the new definition, without
    // touching their dependencies.
    const apiScale = firstIndex(host, `up -d --no-deps --no-recreate --wait --scale ${API}=4 ${API}`);
    const webScale = firstIndex(host, `up -d --no-deps --no-recreate --wait --scale ${WEB}=2 ${WEB}`);
    expect(apiScale).toBeGreaterThan(0);
    expect(webScale).toBeGreaterThan(apiScale);
    // Old web goes before old API, and only once both new services are healthy.
    const [oldApiA, oldApiB, oldWeb] = ["c001", "c002", "c003"];
    const stopWeb = firstIndex(host, `stop ${oldWeb}`);
    const stopApi = firstIndex(host, `stop ${oldApiA} ${oldApiB}`);
    expect(stopWeb).toBeGreaterThan(webScale);
    expect(stopApi).toBeGreaterThan(stopWeb);
    expect(firstIndex(host, "up -d --wait --remove-orphans")).toBeGreaterThan(stopApi);
    expect(host.containers.filter((c) => c.service === API).map((c) => c.hash)).toEqual(["api-new", "api-new"]);
    expect(host.containers.filter((c) => c.service === WEB).map((c) => c.hash)).toEqual(["web-new"]);
  });

  it("moves the port from a web server that published it to the gateway right after it stops", async () => {
    const root = initialized();
    const host = previousRelease();

    await apply(root, host);

    // Web is replaced side by side even without direct routes: the gateway holds the port.
    const webScale = firstIndex(host, `--scale ${WEB}=2 ${WEB}`);
    const stopWeb = firstIndex(host, "stop c003");
    const gatewayUp = firstIndex(host, `up -d --no-deps --wait ${GATEWAY}`);
    const stopApi = firstIndex(host, "stop c001 c002");
    expect(webScale).toBeGreaterThan(firstIndex(host, `--scale ${API}=4 ${API}`));
    expect(stopWeb).toBeGreaterThan(webScale);
    // The gateway binds the port as soon as the old web server let it go, before the API is touched.
    expect(gatewayUp).toBeGreaterThan(stopWeb);
    expect(stopApi).toBeGreaterThan(gatewayUp);
    const rollout = host.log.slice(firstIndex(host, "run --rm --no-deps migrate"));
    for (const entry of rollout) {
      expect(entry.running.some((name) => name.startsWith(`${API}:`)), entry.line).toBe(true);
    }
    expect(host.running(GATEWAY)).toHaveLength(1);
  });

  it("leaves a service alone when it already runs the new definition", async () => {
    const root = initialized(withGateway);
    const host = new FakeHost("example-app", { [API]: "api-new", [WEB]: "web-new", [GATEWAY]: "gateway" });
    host.add(API, "api-new");
    host.add(API, "api-new");
    host.add(WEB, "web-old");

    await apply(root, host);

    expect(firstIndex(host, `--scale ${API}=`)).toBe(-1);
    expect(firstIndex(host, `--scale ${WEB}=2 ${WEB}`)).toBeGreaterThan(0);
    expect(host.containers.filter((c) => c.service === API).map((c) => c.id)).toEqual(["c001", "c002"]);
  });

  it("starts a first deployment with compose up alone", async () => {
    const root = initialized(withGateway);
    const host = new FakeHost("example-app", { [API]: "api-new", [WEB]: "web-new", [GATEWAY]: "gateway" });

    await apply(root, host);

    expect(firstIndex(host, "--scale")).toBe(-1);
    expect(firstIndex(host, "up -d --wait --remove-orphans")).toBeGreaterThan(0);
    expect(host.running(API)).toHaveLength(1);
  });

  it("removes what it started and keeps the old release serving when a new container fails", async () => {
    const root = initialized(withGateway);
    const host = previousRelease();
    host.add(GATEWAY, "gateway");
    host.failScaleOf = WEB;

    await expect(apply(root, host)).rejects.toThrow(`--scale ${WEB}=2`);

    expect(host.containers.map((c) => `${c.service}:${c.hash}:${c.running}`).sort()).toEqual([
      `${API}:api-old:true`,
      `${API}:api-old:true`,
      `${GATEWAY}:gateway:true`,
      `${WEB}:web-old:true`,
    ]);
    expect(firstIndex(host, " stop ")).toBe(-1);
    expect(firstIndex(host, "--remove-orphans")).toBe(-1);
    // No new ledger entry: the old release is still the current revision.
    expect(host.log.filter((entry) => entry.line.includes("releases.json.tmp"))).toEqual([]);
  });

  it("removes a stopped container before scaling, so it is not started again", async () => {
    const root = initialized(withGateway);
    const host = previousRelease();
    const stopped = host.add(API, "api-old", false);

    await apply(root, host);

    expect(firstIndex(host, `rm -f ${stopped}`)).toBeLessThan(firstIndex(host, `--scale ${API}=4`));
  });

  it("runs the object storage init job with the dependencies, and stops when it fails", async () => {
    const managedStorage = (profile: Record<string, unknown>): void => {
      withGateway(profile);
      (profile.dependencies as { objectStorage: { mode: string } }).objectStorage.mode = "managed";
    };
    const root = initialized(managedStorage);
    const host = previousRelease();

    await apply(root, host);

    const init = firstIndex(host, "up -d --no-deps example-app-object-storage-init");
    expect(firstIndex(host, "up -d --wait example-app-postgres example-app-object-storage")).toBeLessThan(init);
    expect(firstIndex(host, "--context production wait ")).toBeGreaterThan(init);
    expect(firstIndex(host, "run --rm --no-deps migrate")).toBeGreaterThan(init);

    const failing = previousRelease();
    failing.initStatus = 1;
    await expect(apply(initialized(managedStorage), failing)).rejects.toThrow(
      "example-app-object-storage-init exited with status 1",
    );
    expect(firstIndex(failing, "run --rm --no-deps migrate")).toBe(-1);
  });

  it("creates the network without replacing running containers when nothing else is managed", async () => {
    const root = initialized((profile) => {
      const dependencies = profile.dependencies as Record<string, { mode: string }>;
      for (const name of ["postgres", "redis", "objectStorage"]) dependencies[name]!.mode = "disabled";
    });
    const host = previousRelease();

    await apply(root, host);

    const network = host.log.find((entry) => entry.line.includes("up -d --no-start"));
    expect(network?.line).toContain("up -d --no-start --no-recreate");
  });
});

describe("compose rollout rendering", () => {
  function profileOf(root: string) {
    return parseComposeProfile(JSON.parse(readFileSync(profilePath(root, "production"), "utf8")));
  }

  function gatewayBlock(document: string): string {
    return document.split(`\n  ${GATEWAY}:\n`)[1]?.split(/\n {2}\S/)[0] ?? "";
  }

  it("renders the same gateway for every release", () => {
    const profile = profileOf(initialized(withGateway));
    const render = (release: string, state: string) =>
      renderComposeDocument(profile, release, defaultComposeImages(profile, release), state, NO_APP_PROXY_TIMEOUTS);
    const first = gatewayBlock(render("v1.2.3", "sha256:a"));
    expect(first).toContain("io.podokit.project");
    expect(first).not.toContain("io.podokit.release");
    expect(gatewayBlock(render("v1.2.4", "sha256:b"))).toBe(first);
  });

  it("turns off Bun's DNS cache in the web server only, unless the profile sets it", () => {
    const root = initialized();
    const profile = profileOf(root);
    const block = (document: string, service: string) =>
      document.split(`\n  ${service}:\n`)[1]?.split(/\n {2}\S/)[0] ?? "";
    const render = () =>
      renderComposeDocument(profile, "v1.2.3", defaultComposeImages(profile, "v1.2.3"), "sha256:0", NO_APP_PROXY_TIMEOUTS);
    expect(block(render(), WEB)).toContain('BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS: "0"');
    expect(block(render(), API)).not.toContain("BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS");
    profile.runtimeConfig.BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS = "5";
    expect(block(render(), WEB)).toContain('BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS: "5"');
  });
});
