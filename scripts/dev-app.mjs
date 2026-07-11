#!/usr/bin/env node
// Maintainer helper: scaffold a throwaway app wired to THIS monorepo's local
// build, so template/module/api-client changes can be verified without
// publishing @podosoft/podokit-api-client to npm.
//
// Usage:
//   node scripts/dev-app.mjs <targetDir> [--template <t>] [--add mod1,mod2] [--no-build]
//
// It builds the monorepo, generates the app with the local CLI, points the
// web app's @podosoft/podokit-api-client at the local package (file:), applies
// any requested modules, and runs npm install.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const targetDir = positional[0];
if (!targetDir) {
  console.error("usage: node scripts/dev-app.mjs <targetDir> [--template <t>] [--add mod1,mod2] [--no-build]");
  process.exit(1);
}
const target = resolve(targetDir);
const template = flag("template") ?? "fullstack-nest-svelte";
const modules = (flag("add") ?? "").split(",").map((m) => m.trim()).filter(Boolean);
const name = target.split("/").pop();

const run = (cmd, cmdArgs, cwd = repoRoot) =>
  execFileSync(cmd, cmdArgs, { cwd, stdio: "inherit" });

if (!args.includes("--no-build")) {
  console.log("• building monorepo…");
  run("npm", ["run", "build"]);
}

console.log(`• generating ${name} (${template}) at ${target}…`);
rmSync(target, { recursive: true, force: true });
run("node", [join(repoRoot, "packages/cli/dist/index.js"), "create", name, "--dir", target, "--template", template, "--yes"]);

// --published: use the published @podosoft packages instead of local file: links.
// Required for containerized dev apps — a host `file:` path does not exist inside
// the container, so its symlink dangles and `@podosoft/*` fails to resolve at
// runtime (see docs/pitfalls.md P-008). Use this when the @podosoft packages have
// no unpublished local changes (e.g. verifying only template/module edits).
const usePublished = args.includes("--published");

// Point the web app at the LOCAL api-client package (re-packed on each install).
if (!usePublished) {
  const webPkgPath = join(target, "apps/web/package.json");
  const webPkg = JSON.parse(readFileSync(webPkgPath, "utf8"));
  if (webPkg.dependencies?.["@podosoft/podokit-api-client"]) {
    webPkg.dependencies["@podosoft/podokit-api-client"] = `file:${join(repoRoot, "packages/api-client")}`;
    writeFileSync(webPkgPath, `${JSON.stringify(webPkg, null, 2)}\n`);
    console.log("• linked @podosoft/podokit-api-client -> local package");
  }
}

for (const mod of modules) {
  console.log(`• podo add ${mod}…`);
  run("node", [join(repoRoot, "packages/cli/dist/index.js"), "add", mod], target);
}

// Pin the unpublished @podosoft packages to their local builds via root npm
// overrides, so nested resolution (e.g. api-client's dependency on contracts)
// also uses the local copy instead of hitting the registry. Skipped for
// --published (containerized apps use the registry versions).
if (!usePublished) {
  const rootPkgPath = join(target, "package.json");
  const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf8"));
  rootPkg.overrides = {
    ...(rootPkg.overrides ?? {}),
    "@podosoft/podokit-contracts": `file:${join(repoRoot, "packages/contracts")}`,
    "@podosoft/podokit-auth": `file:${join(repoRoot, "packages/podokit-auth")}`,
    "@podosoft/podokit-api-client": `file:${join(repoRoot, "packages/api-client")}`,
  };
  writeFileSync(rootPkgPath, `${JSON.stringify(rootPkg, null, 2)}\n`);
  console.log("• pinned local @podosoft/podokit-contracts + api-client via overrides");
} else {
  console.log("• using published @podosoft packages (container-friendly)");
}

console.log("• npm install…");
run("npm", ["install", "--no-audit", "--no-fund"], target);

console.log(`\nDone. Local dev app at ${target}`);
console.log("After editing api-client:  npm run build -w @podosoft/podokit-api-client  (in the monorepo),");
console.log(`then re-run npm install in ${target} to pick up the change.`);
