#!/usr/bin/env node
// Faithful e2e: publish the packages to a local Verdaccio registry, generate an
// app with the real `npx @podosoft/podokit create` (+ `podo add`), migrate, start
// the API + web, and run the shipped Playwright suite. This is the (B) "Outer"
// loop — the exact install/generate path a user runs. See docs/testing.md.
//
// Usage: node scripts/e2e-ci.mjs [--smoke | --package-smoke] [--keep]
// Env (with CI-friendly defaults): REGISTRY_PORT, API_PORT, WEB_PORT,
//   OUTAGE_WEB_PORT,
//   SECONDARY_API_PORT,
//   POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB,
//   APP_DIR, E2E_BUN_CACHE, KEEP.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPhaseTimer,
  playwrightArguments,
  resolveE2eOptions,
} from "./e2e-ci-lib.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const options = resolveE2eOptions(args);
const smoke = options.mode === "smoke";
const packageSmoke = options.mode === "package-smoke";
const { grep, keep } = options;

const env = {
  REGISTRY_PORT: process.env.REGISTRY_PORT ?? "4873",
  // Distinct from the dev-app default ports (web 5001 / api 5002) so a running
  // standing dev app never collides with the isolated Outer verification.
  API_PORT: process.env.API_PORT ?? "5012",
  WEB_PORT: process.env.WEB_PORT ?? "5011",
  OUTAGE_WEB_PORT: process.env.OUTAGE_WEB_PORT ?? "5013",
  SECONDARY_API_PORT: process.env.SECONDARY_API_PORT ?? "5014",
  POSTGRES_HOST: process.env.POSTGRES_HOST ?? "localhost",
  POSTGRES_PORT: process.env.POSTGRES_PORT ?? "5432",
  POSTGRES_USER: process.env.POSTGRES_USER ?? "podokit",
  POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD ?? "podokit",
  POSTGRES_DB: process.env.POSTGRES_DB ?? "podokit",
};
const registry = `http://localhost:${env.REGISTRY_PORT}`;
const webURL = `http://localhost:${env.WEB_PORT}`;
const outageWebURL = `http://localhost:${env.OUTAGE_WEB_PORT}`;
const appDir = process.env.APP_DIR ? resolve(process.env.APP_DIR) : mkdtempSync(join(tmpdir(), "podokit-e2e-"));
const rateLimitKeyPrefix = `podokit:e2e:${process.pid}:${Date.now()}:rate-limit`;
const EXTERNAL_MODULES = [
  {
    name: "blog",
    packageName: "@podosoft/podokit-module-blog",
  },
  {
    name: "analytics",
    packageName: "@podosoft/podokit-module-analytics",
  },
];
// Publish order: contracts first (api-client depends on it), then the rest.
const PACKAGES = [
  "@podosoft/podokit-contracts",
  "@podosoft/podokit-auth",
  "@podosoft/podokit-template-engine",
  "@podosoft/podokit-api-client",
  "@podosoft/podokit",
  ...EXTERNAL_MODULES.map(({ packageName }) => packageName),
];

const children = [];
function run(cmd, cmdArgs, opts = {}) {
  execFileSync(cmd, cmdArgs, { stdio: "inherit", ...opts });
}
function bg(cmd, cmdArgs, opts = {}) {
  // Own process group (detached) so cleanup can kill the whole tree — npx spawns
  // grandchildren (e.g. Verdaccio) that a direct child.kill() would orphan.
  const child = spawn(cmd, cmdArgs, { stdio: "inherit", detached: true, ...opts });
  children.push(child);
  return child;
}
function stop(child) {
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already stopped */
    }
  }
}
async function waitFor(url, label, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 401 || res.status === 404) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timed out waiting for ${label} (${url})`);
}
async function assertProcessRunning(child, label) {
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  if (child.exitCode !== null || child.signalCode !== null) {
    throw new Error(`${label} exited before becoming stable`);
  }
}
function cleanup() {
  for (const c of children) {
    try {
      // Negative pid targets the whole process group (see bg()).
      process.kill(-c.pid, "SIGKILL");
    } catch {
      try {
        c.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }
  if (!keep) rmSync(appDir, { recursive: true, force: true });
  rmSync(join(repoRoot, ".verdaccio-storage"), { recursive: true, force: true });
}
process.on("SIGINT", () => {
  cleanup();
  process.exit(1);
});

const timer = createPhaseTimer();
const step = (message) => timer.start(message);

async function main() {
  step("build the monorepo");
  run("npm", ["run", "build"], { cwd: repoRoot });

  step(`start Verdaccio on ${registry}`);
  rmSync(join(repoRoot, ".verdaccio-storage"), { recursive: true, force: true });
  bg("npx", ["verdaccio", "--config", "scripts/verdaccio.yaml", "--listen", env.REGISTRY_PORT], { cwd: repoRoot });
  await waitFor(`${registry}/-/ping`, "verdaccio");

  step("publish packages to the local registry");
  // A dummy token — Verdaccio's $all publish policy accepts it.
  const npmrc = join(appDir, ".e2e-npmrc");
  mkdirSync(appDir, { recursive: true });
  writeFileSync(npmrc, `//localhost:${env.REGISTRY_PORT}/:_authToken=e2e\nregistry=${registry}\n`);
  for (const pkg of PACKAGES) {
    // --provenance=false: packages set publishConfig.provenance for real npm; a
    // local registry can't attest, so turn it off for the Verdaccio publish.
    run("npm", ["publish", "-w", pkg, "--registry", registry, "--userconfig", npmrc, "--provenance=false"], { cwd: repoRoot });
  }

  step("generate an app the way a user would (npx create from the registry)");
  // npx caches packages by version under ~/.npm/_npx; since we republish the same
  // version to a throwaway registry each run, a stale cached CLI would mask template
  // changes on local reruns (CI runners start clean). Clear it so the create/add
  // below always fetch the freshly published packages.
  rmSync(join(homedir(), ".npm", "_npx"), { recursive: true, force: true });
  const target = join(appDir, "app");
  const npmEnv = { ...process.env, npm_config_registry: registry, npm_config_userconfig: npmrc };
  run("npx", ["--yes", "@podosoft/podokit", "create", "app", "--dir", target, "--template", "fullstack", "--yes"], { cwd: appDir, env: npmEnv });
  run("npx", ["--yes", "@podosoft/podokit", "add", "admin-dashboard"], { cwd: target, env: npmEnv });
  // Backend modules whose shipped api specs need Redis / MinIO — added so their
  // tests run in the Outer loop (they self-skip when a backing service is absent).
  // Blog pulls in rate-limit. Auth and runtime traffic receive high ceilings in
  // the shared suite, while the ordinary limit stays at its production default
  // so the rate-limit spec can exercise a real 200 -> 429 transition.
  for (const mod of ["redis", "bullmq", "sse", "file-upload", "api-key-auth", "job-progress"]) {
    run("npx", ["--yes", "@podosoft/podokit", "add", mod], { cwd: target, env: npmEnv });
  }
  writeFileSync(
    join(target, ".npmrc"),
    `registry=${registry}\n//localhost:${env.REGISTRY_PORT}/:_authToken=e2e\n`,
  );
  for (const external of EXTERNAL_MODULES) {
    run(
      "bun",
      [
        "add",
        "--dev",
        external.packageName,
        "--registry",
        registry,
        ...(process.env.E2E_BUN_CACHE
          ? ["--cache-dir", process.env.E2E_BUN_CACHE]
          : []),
      ],
      { cwd: target, env: npmEnv },
    );
    run("npx", ["--yes", "@podosoft/podokit", "add", external.name], {
      cwd: target,
      env: npmEnv,
    });
  }

  step("install (resolving @podosoft/* from the registry)");
  run("bun", [
    "install",
    ...(process.env.E2E_BUN_CACHE
      ? ["--cache-dir", process.env.E2E_BUN_CACHE]
      : []),
  ], { cwd: target });

  step("write .env");
  writeFileSync(
    join(target, ".env"),
    [
      "NODE_ENV=development",
      `PORT=${env.API_PORT}`,
      `POSTGRES_HOST=${env.POSTGRES_HOST}`,
      `POSTGRES_PORT=${env.POSTGRES_PORT}`,
      `POSTGRES_USER=${env.POSTGRES_USER}`,
      `POSTGRES_PASSWORD=${env.POSTGRES_PASSWORD}`,
      `POSTGRES_DB=${env.POSTGRES_DB}`,
      `BACKEND_INTERNAL_URL=http://localhost:${env.API_PORT}`,
      `CORS_ORIGIN=${webURL}`,
      "BETTER_AUTH_SECRET=e2e-secret-please-change-32-characters",
      `BETTER_AUTH_URL=http://localhost:${env.API_PORT}`,
      "ADMIN_EMAILS=admin@example.com",
      // Auth feature flags (2FA, magic link, OTP, username, multi-session) live in
      // the DB — the app_setting migration seeds them on; seed.setup toggles the
      // phoneNumber flag for its tests. Only server-enforced flags are env:
      // exercise the breached-password check end to end.
      "AUTH_HIBP=true",
      // The audit-log module ships with this fallback enabled. Preserve that
      // module default after the faithful harness replaces the generated .env.
      "AUDIT_LOG_ENABLED=true",
      `RATE_LIMIT_KEY_PREFIX=${rateLimitKeyPrefix}`,
      "RATE_LIMIT_MAX=300",
      "RATE_LIMIT_AUTH_MAX=10000",
      "RATE_LIMIT_RUNTIME_MAX=10000",
      // Point mail at the CI Mailpit service when present so the email specs run;
      // otherwise the app logs mail and those specs skip.
      ...(process.env.SMTP_HOST
        ? [`SMTP_HOST=${process.env.SMTP_HOST}`, `SMTP_PORT=${process.env.SMTP_PORT ?? "1025"}`, "MAIL_FROM=PodoKit <no-reply@example.com>"]
        : []),
      // Route phone-number OTPs to the SMS sink when present so its spec can read
      // the code back; otherwise the app logs it and the spec skips.
      ...(process.env.SMS_WEBHOOK_URL ? [`SMS_WEBHOOK_URL=${process.env.SMS_WEBHOOK_URL}`] : []),
      // Redis (redis/bullmq/job-progress specs) and S3/MinIO (storage/file-upload
      // specs) are wired only when the CI service is present; otherwise those specs
      // self-skip. The api-key spec always has its static key.
      ...(process.env.REDIS_URL
        ? [`REDIS_URL=${process.env.REDIS_URL}`, "SSE_TRANSPORT=redis"]
        : process.env.REDIS_HOST
          ? [
              `REDIS_HOST=${process.env.REDIS_HOST}`,
              `REDIS_PORT=${process.env.REDIS_PORT ?? "6379"}`,
              ...(process.env.REDIS_USERNAME ? [`REDIS_USERNAME=${process.env.REDIS_USERNAME}`] : []),
              ...(process.env.REDIS_PASSWORD ? [`REDIS_PASSWORD=${process.env.REDIS_PASSWORD}`] : []),
              ...(process.env.REDIS_DB ? [`REDIS_DB=${process.env.REDIS_DB}`] : []),
              ...(process.env.REDIS_TLS ? [`REDIS_TLS=${process.env.REDIS_TLS}`] : []),
              "SSE_TRANSPORT=redis",
            ]
          : []),
      ...(process.env.S3_ENDPOINT
        ? ["STORAGE_PROVIDER=minio", `S3_ENDPOINT=${process.env.S3_ENDPOINT}`, `S3_REGION=${process.env.S3_REGION ?? "us-east-1"}`, `S3_BUCKET=${process.env.S3_BUCKET ?? "podokit"}`, `S3_ACCESS_KEY_ID=${process.env.S3_ACCESS_KEY_ID ?? "podokit"}`, `S3_SECRET_ACCESS_KEY=${process.env.S3_SECRET_ACCESS_KEY ?? "podokitsecret"}`, "S3_FORCE_PATH_STYLE=true"]
        : []),
      "API_KEYS=dev-key-please-change",
    ].join("\n") + "\n",
  );

  // Local SMS sink (the dev "Mailpit for SMS") — the api posts OTPs here and the
  // phone-number spec reads them back over REST.
  const smsSinkPort = process.env.SMS_SINK_PORT ?? "8095";
  const smsSinkURL = `http://localhost:${smsSinkPort}`;

  const pgEnv = {
    ...process.env,
    POSTGRES_HOST: env.POSTGRES_HOST,
    POSTGRES_PORT: env.POSTGRES_PORT,
    POSTGRES_USER: env.POSTGRES_USER,
    POSTGRES_PASSWORD: env.POSTGRES_PASSWORD,
    POSTGRES_DB: env.POSTGRES_DB,
    BETTER_AUTH_SECRET: "e2e-secret-please-change-32-characters",
    ADMIN_EMAILS: "admin@example.com",
    // Runtime env for the built Bun API. Auth feature flags
    // are DB-backed (migration-seeded), so only server-enforced env remains.
    AUTH_HIBP: "true",
    AUDIT_LOG_ENABLED: "true",
    RATE_LIMIT_KEY_PREFIX: rateLimitKeyPrefix,
    RATE_LIMIT_MAX: "300",
    RATE_LIMIT_AUTH_MAX: "10000",
    RATE_LIMIT_RUNTIME_MAX: "10000",
    // Route phone-number OTPs to the local SMS sink so the phone spec can read them.
    SMS_WEBHOOK_URL: `${smsSinkURL}/sms`,
    // Backend-module runtime config (present only when the CI service is up).
    ...(process.env.REDIS_URL
      ? { REDIS_URL: process.env.REDIS_URL, SSE_TRANSPORT: "redis" }
      : process.env.REDIS_HOST
        ? {
            REDIS_HOST: process.env.REDIS_HOST,
            REDIS_PORT: process.env.REDIS_PORT ?? "6379",
            ...(process.env.REDIS_USERNAME ? { REDIS_USERNAME: process.env.REDIS_USERNAME } : {}),
            ...(process.env.REDIS_PASSWORD ? { REDIS_PASSWORD: process.env.REDIS_PASSWORD } : {}),
            ...(process.env.REDIS_DB ? { REDIS_DB: process.env.REDIS_DB } : {}),
            ...(process.env.REDIS_TLS ? { REDIS_TLS: process.env.REDIS_TLS } : {}),
            SSE_TRANSPORT: "redis",
          }
        : {}),
    ...(process.env.S3_ENDPOINT
      ? { STORAGE_PROVIDER: "minio", S3_ENDPOINT: process.env.S3_ENDPOINT, S3_REGION: process.env.S3_REGION ?? "us-east-1", S3_BUCKET: process.env.S3_BUCKET ?? "podokit", S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? "podokit", S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? "podokitsecret", S3_FORCE_PATH_STYLE: "true" }
      : {}),
    API_KEYS: "dev-key-please-change",
  };

  step("build api");
  run("bun", ["run", "--cwd", "apps/api", "build"], { cwd: target });

  step("migrate auth and app tables from compiled output");
  run("bun", ["run", "--cwd", "apps/api", "migrate:all"], { cwd: target, env: pgEnv });

  step("verify generated API contract");
  run("bun", ["run", "--cwd", "apps/api", "contract"], { cwd: target, env: pgEnv });

  step("build web");
  run("bun", ["run", "--cwd", "apps/web", "build"], {
    cwd: target,
    env: { ...process.env, PODOKIT_BUILD_ORIGIN: webURL },
  });

  if (!packageSmoke) {
    step("verify protected routes fail closed during a backend outage");
    const unavailableWeb = bg("bun", ["build/index.js"], {
      cwd: join(target, "apps/web"),
      env: {
        ...process.env,
        PORT: env.OUTAGE_WEB_PORT,
        ORIGIN: outageWebURL,
        BACKEND_INTERNAL_URL: "http://127.0.0.1:1",
      },
    });
    await waitFor(`${outageWebURL}/`, "outage verification web");
    const publicDuringOutage = await fetch(`${outageWebURL}/`, { redirect: "manual" });
    if (publicDuringOutage.status !== 200) {
      throw new Error(`public route returned ${publicDuringOutage.status} during backend outage`);
    }
    const protectedDuringOutage = await fetch(`${outageWebURL}/admin`, {
      redirect: "manual",
      headers: { cookie: "better-auth.session_token=preserve-during-outage" },
    });
    if (protectedDuringOutage.status !== 503) {
      throw new Error(`protected route returned ${protectedDuringOutage.status} instead of 503 during backend outage`);
    }
    if (protectedDuringOutage.headers.has("location")) {
      throw new Error("protected route redirected during backend outage");
    }
    if (protectedDuringOutage.headers.has("set-cookie")) {
      throw new Error("protected route modified the session cookie during backend outage");
    }
    stop(unavailableWeb);
  }

  step("start api + web");
  bg("bun", [join(target, "infra/docker/sms-sink.mjs")], { cwd: target, env: { ...process.env, PORT: smsSinkPort } });
  await waitFor(`${smsSinkURL}/readyz`, "sms-sink");
  bg("bun", ["dist/main.js"], {
    cwd: join(target, "apps/api"),
    env: { ...pgEnv, PORT: env.API_PORT, BETTER_AUTH_URL: `http://localhost:${env.API_PORT}`, CORS_ORIGIN: webURL },
  });
  await waitFor(`http://localhost:${env.API_PORT}/health`, "api");
  const hasRedis = Boolean(process.env.REDIS_URL || process.env.REDIS_HOST);
  if (hasRedis) {
    bg("bun", ["dist/main.js"], {
      cwd: join(target, "apps/api"),
      env: {
        ...pgEnv,
        PORT: env.SECONDARY_API_PORT,
        BETTER_AUTH_URL: `http://localhost:${env.API_PORT}`,
        CORS_ORIGIN: webURL,
      },
    });
    const secondaryHealthPath = process.env.S3_ENDPOINT ? "/health/ready" : "/health";
    await waitFor(
      `http://localhost:${env.SECONDARY_API_PORT}${secondaryHealthPath}`,
      "secondary api",
    );
  }
  // BullMQ worker (bullmq/job-progress) — separate process; harmless (idle) if Redis is absent.
  const worker = bg("bun", ["dist/main-worker.js"], { cwd: join(target, "apps/api"), env: pgEnv });
  await assertProcessRunning(worker, "BullMQ worker");
  bg("bun", ["build/index.js"], {
    cwd: join(target, "apps/web"),
    env: {
      ...process.env,
      PORT: env.WEB_PORT,
      ORIGIN: webURL,
      BACKEND_INTERNAL_URL: `http://localhost:${env.API_PORT}`,
      BODY_SIZE_LIMIT: "3M",
    },
  });
  await waitFor(`${webURL}/login`, "web");

  if (packageSmoke) {
    const apiHealth = await fetch(`http://localhost:${env.API_PORT}/health`);
    if (!apiHealth.ok) throw new Error(`api health check returned ${apiHealth.status}`);
    const loginPage = await fetch(`${webURL}/login`);
    if (!loginPage.ok) throw new Error(`web login check returned ${loginPage.status}`);
    timer.finish();
    console.log("\n✓ faithful package smoke passed");
    return;
  }

  step("install Playwright Chromium");
  run("bunx", ["playwright", "install", "--with-deps", "chromium"], { cwd: join(target, "tests") });
  step(`run Playwright${smoke ? " smoke" : " full suite"}`);
  // --grep wins when given (run just one feature's specs); otherwise --smoke runs
  // the @smoke subset, and the default runs everything.
  const testArgs = playwrightArguments(options);
  // A developer may already have an unrelated Mailpit bound to the default
  // port. Only expose Mailpit to the generated tests when SMTP is also wired to
  // it; otherwise email specs must skip instead of reading from the wrong sink.
  const mailpitURL = process.env.SMTP_HOST
    ? (process.env.MAILPIT_URL ?? "http://localhost:8025")
    : "http://127.0.0.1:1";
  run("bunx", testArgs, {
    cwd: join(target, "tests"),
    env: {
      ...process.env,
      E2E_BASE_URL: webURL,
      E2E_API_URL: `http://localhost:${env.API_PORT}`,
      RATE_LIMIT_MAX: pgEnv.RATE_LIMIT_MAX,
      ...(hasRedis
        ? { E2E_SECONDARY_API_URL: `http://localhost:${env.SECONDARY_API_PORT}` }
        : {}),
      MAILPIT_URL: mailpitURL,
      SMS_SINK_URL: smsSinkURL,
    },
  });

  timer.finish();
  console.log("\n✓ faithful e2e passed");
}

main()
  .catch((err) => {
    console.error(err.message ?? err);
    process.exitCode = 1;
  })
  .finally(() => {
    timer.finish();
    // The background children (Verdaccio, api, web) inherit stdio and keep the
    // event loop alive, so the run never exits on its own. Kill them and exit
    // explicitly — otherwise CI hangs until the job timeout.
    cleanup();
    process.exit(process.exitCode ?? 0);
  });
