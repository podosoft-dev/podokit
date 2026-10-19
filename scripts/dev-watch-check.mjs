#!/usr/bin/env node
// Maintainer check: run `podo dev watch` on a generated app and confirm that the
// containers follow the work tree. It needs Docker and the shared gateway on
// 127.0.0.1:80, and builds the development image, so it is not part of CI.
//
// Usage:
//   node scripts/dev-watch-check.mjs <appDir> [--no-generate] [--keep]
//   PODOKIT_CLI=<other>/packages/cli/dist/index.js node scripts/dev-watch-check.mjs <appDir> --no-generate
//
// It generates the app with the local CLI and the published @podosoft packages
// (scripts/dev-app.mjs --published --add auth) unless --no-generate is given,
// starts from an empty development database, and checks that:
//   1. the API applies pending migrations before it starts, and again when a
//      migration file arrives while Watch runs;
//   2. a web container recreated from an older image (`docker compose up
//      --no-build`) is rebuilt and serves the work tree;
//   3. a component deleted and created again is served in its new version.
// The stack is taken down with its volumes at the end unless --keep is given.
// Every phase prints how long it took.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, openSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPhaseTimer } from "./e2e-ci-lib.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// PODOKIT_CLI checks another build, such as a release, against an app from --no-generate.
const cli = process.env.PODOKIT_CLI ? resolve(process.env.PODOKIT_CLI) : join(repoRoot, "packages/cli/dist/index.js");
const args = process.argv.slice(2);
const appDir = args.find((value) => !value.startsWith("--"));
if (!appDir) {
  console.error("usage: node scripts/dev-watch-check.mjs <appDir> [--no-generate] [--keep]");
  process.exit(2);
}
const app = resolve(appDir);
const name = basename(app);
const host = `${name}.localhost`;
const timer = createPhaseTimer();
const failures = [];

const run = (command, commandArgs, options = {}) =>
  execFileSync(command, commandArgs, { cwd: app, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...options });
const podo = (...podoArgs) => run("node", [cli, ...podoArgs]);
const sleep = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));

/** GET through the shared gateway, which routes by Host. */
function get(path) {
  return new Promise((done) => {
    const req = request({ host: "127.0.0.1", port: 80, path, headers: { host } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => (body += chunk));
      response.on("end", () => done({ status: response.statusCode ?? 0, body }));
    });
    req.setTimeout(10_000, () => req.destroy());
    req.on("error", () => done({ status: 0, body: "" }));
    req.end();
  });
}

async function waitFor(description, probe, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await probe();
    if (last === true) return true;
    await sleep(500);
  }
  failures.push(`${description} (last: ${JSON.stringify(last)})`);
  console.error(`FAIL ${description}`);
  return false;
}

function check(description, ok) {
  console.log(`${ok ? "ok  " : "FAIL"} ${description}`);
  if (!ok) failures.push(description);
}

function appliedMigrations() {
  try {
    return podo("dev", "exec", "-T", "postgres", "psql", "-U", "podokit", "-d", "podokit", "-Atc",
      'SELECT "name" FROM "migrations" ORDER BY "id"').trim().split("\n").filter(Boolean);
  } catch {
    return []; // No migrations table yet.
  }
}

function writeApp(path, content) {
  mkdirSync(dirname(join(app, path)), { recursive: true });
  writeFileSync(join(app, path), content);
}

if (!args.includes("--no-generate")) {
  timer.start(`generate ${name} with the local CLI and published packages`);
  execFileSync("node", [join(repoRoot, "scripts/dev-app.mjs"), app, "--add", "auth", "--published"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

timer.start("start from an empty development database");
try {
  podo("dev", "down", "--volumes");
} catch {
  // Nothing was running.
}

timer.start("podo dev watch until the API is ready");
const log = join(app, ".podokit/runtime/dev-watch-check.log");
mkdirSync(dirname(log), { recursive: true });
const output = openSync(log, "w");
const watcher = spawn("node", [cli, "dev", "watch"], { cwd: app, stdio: ["ignore", output, output], detached: true });
const watchExited = new Promise((done) => watcher.once("exit", done));
try {
  await waitFor("the API answers /api/health/ready with 200", async () => (await get("/api/health/ready")).status === 200, 600_000);

  timer.start("migrations applied before the first start");
  const first = appliedMigrations();
  check(`an empty database has the template's migrations (${first.join(", ")})`, first.length > 0);
  const signUp = await new Promise((done) => {
    const body = JSON.stringify({ email: "check@example.com", password: "Podokit3e-Str0ng!pw", name: "Check" });
    const req = request(
      { host: "127.0.0.1", port: 80, path: "/api/auth/sign-up/email", method: "POST",
        headers: { host, origin: `http://${host}`, "content-type": "application/json", "content-length": Buffer.byteLength(body) } },
      (response) => { response.resume(); response.on("end", () => done(response.statusCode)); },
    );
    req.on("error", () => done(0));
    req.end(body);
  });
  check(`sign-up succeeds on the migrated auth schema (status ${signUp})`, signUp === 200);

  timer.start("a migration added while Watch runs");
  writeApp("apps/api/src/migrations/1792400000000-AddWatchCheck.ts", [
    'import type { MigrationInterface, QueryRunner } from "typeorm";',
    "",
    "export class AddWatchCheck1792400000000 implements MigrationInterface {",
    '  name = "AddWatchCheck1792400000000";',
    "",
    "  async up(queryRunner: QueryRunner): Promise<void> {",
    "    await queryRunner.query('CREATE TABLE \"watch_check\" (\"id\" integer PRIMARY KEY)');",
    "  }",
    "",
    "  async down(queryRunner: QueryRunner): Promise<void> {",
    "    await queryRunner.query('DROP TABLE \"watch_check\"');",
    "  }",
    "}",
    "",
  ].join("\n"));
  await waitFor("the new migration is applied", async () => appliedMigrations().includes("AddWatchCheck1792400000000"), 60_000);

  timer.start("a web container recreated from an older image");
  writeApp("apps/web/src/routes/watch-check/+page.svelte", "<p>watch-check-v1</p>\n");
  await waitFor("Watch syncs a new page", async () => (await get("/watch-check")).body.includes("watch-check-v1"), 30_000);
  writeApp("apps/web/src/routes/watch-check/+page.svelte", "<p>watch-check-v2</p>\n");
  await waitFor("Watch syncs an edit", async () => (await get("/watch-check")).body.includes("watch-check-v2"), 30_000);
  run("docker", ["compose", "-f", "compose.dev.yaml", "-f", ".podokit/runtime/dev.compose.yaml", "up", "--detach", "--no-build", "--force-recreate", "--no-deps", "web"], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  await waitFor("the recreated web serves the work tree", async () => {
    const page = await get("/watch-check");
    return page.body.includes("watch-check-v2") || `${page.status} ${page.body.match(/watch-check-v\d/)?.[0] ?? ""}`;
  }, 300_000);

  timer.start("a component deleted and created again");
  const module = "/src/routes/watch-check/+page.svelte";
  await waitFor("the browser module is the current version", async () => (await get(module)).body.includes("watch-check-v2"), 30_000);
  rmSync(join(app, "apps/web/src/routes/watch-check/+page.svelte"));
  await waitFor("the deleted component is gone", async () => (await get(module)).status === 404, 30_000);
  writeApp("apps/web/src/routes/watch-check/+page.svelte", "<p>watch-check-v3</p>\n");
  await waitFor("the re-created component is served in its new version", async () => (await get(module)).body.includes("watch-check-v3"), 30_000);
} finally {
  timer.start(args.includes("--keep") ? "stop podo dev watch" : "podo dev down --volumes");
  if (args.includes("--keep")) {
    process.kill(-watcher.pid, "SIGINT");
  } else {
    podo("dev", "down", "--volumes");
  }
  await Promise.race([watchExited, sleep(30_000)]);
  rmSync(join(app, "apps/web/src/routes/watch-check"), { recursive: true, force: true });
  rmSync(join(app, "apps/api/src/migrations/1792400000000-AddWatchCheck.ts"), { force: true });
  timer.finish();
}

console.log(`podo dev watch log: ${log}`);
if (failures.length > 0) {
  console.error(`${failures.length} checks failed:\n${failures.map((failure) => `  - ${failure}`).join("\n")}`);
  process.exit(1);
}
console.log("All podo dev watch checks passed.");
