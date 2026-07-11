#!/usr/bin/env node
// Refresh a CONTAINERIZED dev app (e.g. admin-demo) with the latest templates,
// end to end — the repetitive, error-prone dance done in one command:
//   1. read the app's installed modules from .podokit/manifest.json
//   2. back up .env.docker (instance secret / hostname / CORS / ADMIN_EMAILS)
//   3. docker compose down
//   4. regenerate with dev-app.mjs --published (container-friendly, avoids the
//      host file:-link dangling-symlink issue — docs/pitfalls.md P-008)
//   5. restore .env.docker
//   6. docker compose up -d --build, then force-recreate api (env-cache fix so
//      trustedOrigins pick up the restored CORS_ORIGIN — P-005 "Invalid origin")
//   7. run DB migrations (new module tables)
//   8. health-check: wait until the site answers 200 via Traefik
//
// Usage: node scripts/dev-container-refresh.mjs <appDir> [--add extra,mods]
//   Modules default to the app's current set; --add appends more (e.g. a new module).
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const appDir = args.find((a) => !a.startsWith("--")) && resolve(args.find((a) => !a.startsWith("--")));
const addFlag = (() => {
  const i = args.indexOf("--add");
  return i >= 0 ? (args[i + 1] ?? "") : "";
})();

if (!appDir || !existsSync(join(appDir, ".podokit/manifest.json"))) {
  console.error("usage: node scripts/dev-container-refresh.mjs <appDir> [--add extra,mods]");
  console.error("  <appDir> must be a generated app with .podokit/manifest.json");
  process.exit(1);
}
const compose = join(appDir, "compose.dev.yaml");
if (!existsSync(compose)) {
  console.error(`Not a containerized dev app: ${compose} not found.`);
  process.exit(1);
}

const sh = (cmd, cmdArgs, opts = {}) => {
  console.log(`$ ${cmd} ${cmdArgs.join(" ")}`);
  return execFileSync(cmd, cmdArgs, { stdio: "inherit", ...opts });
};
const capture = (cmd, cmdArgs, opts = {}) =>
  execFileSync(cmd, cmdArgs, { encoding: "utf8", ...opts }).trim();

// 1) modules (installed + --add), deduped
const manifest = JSON.parse(readFileSync(join(appDir, ".podokit/manifest.json"), "utf8"));
const modules = [...new Set([
  ...manifest.modules.map((m) => m.name),
  ...addFlag.split(",").map((m) => m.trim()).filter(Boolean),
])];
console.log(`Modules: ${modules.join(", ")}`);

// 2) back up instance config
const backupDir = mkdtempSync(join(tmpdir(), "podokit-refresh-"));
const envDocker = join(appDir, ".env.docker");
const hasEnv = existsSync(envDocker);
if (hasEnv) copyFileSync(envDocker, join(backupDir, ".env.docker"));
// read the public host from CORS_ORIGIN for the health check
const corsLine = hasEnv ? (readFileSync(envDocker, "utf8").match(/^CORS_ORIGIN=(.*)$/m)?.[1] ?? "") : "";
const host = corsLine.replace(/^https?:\/\//, "").trim() || "app.localhost";
console.log(`Instance host: ${host}`);

// 3) compose down
try { sh("docker", ["compose", "-f", compose, "down"], { cwd: appDir }); } catch { /* ok */ }

// 4) regenerate (container-friendly)
sh("node", [join(repoRoot, "scripts/dev-app.mjs"), appDir, "--add", modules.join(","), "--published"]);

// 5) restore instance config
if (hasEnv) {
  copyFileSync(join(backupDir, ".env.docker"), envDocker);
  console.log("- restored .env.docker");
}

// 6) up + rebuild, then force-recreate api so it re-reads the restored env
sh("docker", ["compose", "-f", compose, "up", "-d", "--build"], { cwd: appDir });
sh("docker", ["compose", "-f", compose, "up", "-d", "--force-recreate", "--no-build", "api"], { cwd: appDir });
sh("docker", ["compose", "-f", compose, "up", "-d"], { cwd: appDir }); // ensure traefik/web are up

// 7) wait for api, then run migrations
const waitApi = async () => {
  for (let i = 0; i < 30; i++) {
    try {
      const logs = capture("docker", ["compose", "-f", compose, "logs", "api"], { cwd: appDir });
      if (logs.includes("Nest application successfully started")) return true;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
};
await waitApi();
try {
  sh("docker", ["compose", "-f", compose, "exec", "-T", "api", "sh", "-c", "cd /app && npm run migration:run -w apps/api"], { cwd: appDir });
} catch {
  console.warn("! migration:run failed (may be up to date or need manual run)");
}

// 8) health check via Traefik
let ok = false;
for (let i = 0; i < 30; i++) {
  try {
    const code = capture("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "-H", `Host: ${host}`, "http://localhost/"]);
    if (code === "200") { ok = true; break; }
  } catch { /* retry */ }
  await new Promise((r) => setTimeout(r, 2000));
}

console.log(`\n${ok ? "[OK]" : "[WARN]"} admin-demo refreshed — http://${host}/  (${ok ? "responding 200" : "not responding yet; check docker compose logs"})`);
console.log("  Log in and verify. Instance config (.env.docker) preserved; DB volume kept.");
