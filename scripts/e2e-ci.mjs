#!/usr/bin/env node
// Faithful e2e: publish the packages to a local Verdaccio registry, generate an
// app with the real `npx @podosoft/podokit create` (+ `podo add`), migrate, start
// the API + web, and run the shipped Playwright suite. This is the (B) "Outer"
// loop — the exact install/generate path a user runs. See docs/testing.md.
//
// Usage: node scripts/e2e-ci.mjs [--smoke] [--keep]
// Env (with CI-friendly defaults): REGISTRY_PORT, API_PORT, WEB_PORT,
//   POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB,
//   APP_DIR, KEEP.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const smoke = args.includes("--smoke");
const keep = args.includes("--keep") || process.env.KEEP === "1";
// --grep <pattern>: run only matching tests (faster feedback on one feature).
const grepIdx = args.indexOf("--grep");
const grep = grepIdx !== -1 ? args[grepIdx + 1] : process.env.GREP;

const env = {
  REGISTRY_PORT: process.env.REGISTRY_PORT ?? "4873",
  // Distinct from the dev-app default ports (web 5001 / api 5002) so a running
  // standing dev app never collides with the isolated Outer verification.
  API_PORT: process.env.API_PORT ?? "5012",
  WEB_PORT: process.env.WEB_PORT ?? "5011",
  POSTGRES_HOST: process.env.POSTGRES_HOST ?? "localhost",
  POSTGRES_PORT: process.env.POSTGRES_PORT ?? "5432",
  POSTGRES_USER: process.env.POSTGRES_USER ?? "podokit",
  POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD ?? "podokit",
  POSTGRES_DB: process.env.POSTGRES_DB ?? "podokit",
};
const registry = `http://localhost:${env.REGISTRY_PORT}`;
const webURL = `http://localhost:${env.WEB_PORT}`;
const appDir = process.env.APP_DIR ? resolve(process.env.APP_DIR) : mkdtempSync(join(tmpdir(), "podokit-e2e-"));
const PACKAGES = ["@podosoft/podokit-template-engine", "@podosoft/podokit-api-client", "@podosoft/podokit"];

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

const step = (m) => console.log(`\n── ${m}`);

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
  run("npx", ["--yes", "@podosoft/podokit", "create", "app", "--dir", target, "--template", "fullstack-nest-svelte", "--yes"], { cwd: appDir, env: npmEnv });
  run("npx", ["--yes", "@podosoft/podokit", "add", "admin-dashboard"], { cwd: target, env: npmEnv });

  step("install (resolving @podosoft/* from the registry)");
  writeFileSync(join(target, ".npmrc"), `registry=${registry}\n//localhost:${env.REGISTRY_PORT}/:_authToken=e2e\n`);
  run("npm", ["install", "--no-audit", "--no-fund"], { cwd: target });

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
      // Point mail at the CI Mailpit service when present so the email specs run;
      // otherwise the app logs mail and those specs skip.
      ...(process.env.SMTP_HOST
        ? [`SMTP_HOST=${process.env.SMTP_HOST}`, `SMTP_PORT=${process.env.SMTP_PORT ?? "1025"}`, "MAIL_FROM=PodoKit <no-reply@example.com>"]
        : []),
      // Route phone-number OTPs to the SMS sink when present so its spec can read
      // the code back; otherwise the app logs it and the spec skips.
      ...(process.env.SMS_WEBHOOK_URL ? [`SMS_WEBHOOK_URL=${process.env.SMS_WEBHOOK_URL}`] : []),
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
    // Runtime env for the built api (`node dist/main` below). Auth feature flags
    // are DB-backed (migration-seeded), so only server-enforced env remains.
    AUTH_HIBP: "true",
    // Route phone-number OTPs to the local SMS sink so the phone spec can read them.
    SMS_WEBHOOK_URL: `${smsSinkURL}/sms`,
  };

  step("migrate the auth tables");
  run("npx", ["--yes", "@better-auth/cli@latest", "migrate", "-y", "--config", "apps/api/src/auth/auth.ts"], { cwd: target, env: pgEnv });

  step("migrate the app tables (TypeORM: app_setting, audit_logs, ...)");
  run("npm", ["run", "migration:run", "-w", "app-api"], { cwd: target, env: pgEnv });

  step("build api + web");
  run("npm", ["run", "build", "-w", "app-api"], { cwd: target });
  run("npm", ["run", "build", "-w", "app-web"], { cwd: target });

  step("start api + web");
  bg("node", [join(target, "infra/docker/sms-sink.mjs")], { cwd: target, env: { ...process.env, PORT: smsSinkPort } });
  await waitFor(`${smsSinkURL}/readyz`, "sms-sink");
  bg("node", ["dist/main"], {
    cwd: join(target, "apps/api"),
    env: { ...pgEnv, PORT: env.API_PORT, BETTER_AUTH_URL: `http://localhost:${env.API_PORT}`, CORS_ORIGIN: webURL },
  });
  await waitFor(`http://localhost:${env.API_PORT}/health`, "api");
  bg("node", ["build"], {
    cwd: join(target, "apps/web"),
    env: { ...process.env, PORT: env.WEB_PORT, ORIGIN: webURL, BACKEND_INTERNAL_URL: `http://localhost:${env.API_PORT}` },
  });
  await waitFor(`${webURL}/login`, "web");

  step(`run e2e${smoke ? " (smoke)" : ""}`);
  run("npx", ["playwright", "install", "--with-deps", "chromium"], { cwd: join(target, "tests") });
  // --grep wins when given (run just one feature's specs); otherwise --smoke runs
  // the @smoke subset, and the default runs everything.
  const testArgs = ["playwright", "test", ...(grep ? ["--grep", grep] : smoke ? ["--grep", "@smoke"] : [])];
  run("npx", testArgs, { cwd: join(target, "tests"), env: { ...process.env, E2E_BASE_URL: webURL, SMS_SINK_URL: smsSinkURL } });

  console.log("\n✓ faithful e2e passed");
}

main()
  .catch((err) => {
    console.error(err.message ?? err);
    process.exitCode = 1;
  })
  .finally(() => {
    // The background children (Verdaccio, api, web) inherit stdio and keep the
    // event loop alive, so the run never exits on its own. Kill them and exit
    // explicitly — otherwise CI hangs until the job timeout.
    cleanup();
    process.exit(process.exitCode ?? 0);
  });
