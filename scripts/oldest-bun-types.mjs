#!/usr/bin/env node
// Pins a generated app's Bun type declarations to the lowest version its API
// declares for @types/bun, so CI type-checks the managed code against the
// oldest types an existing app may have locked. A fresh install resolves the
// newest release, and twice a managed file that passed with it failed `bun run
// lint` in apps that had locked an older one.
//
//   node scripts/oldest-bun-types.mjs <appDir>
//
// Then run `bun install` and `bun run lint` in the app. bun-types is pinned too,
// because packages such as @sveltejs/adapter-bun depend on it directly.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The lowest version an exact, caret, or tilde range allows. */
export function lowestVersion(range) {
  const match = /^[\^~]?(\d+\.\d+\.\d+)$/.exec(range.trim());
  if (!match?.[1]) {
    throw new Error(`Cannot take the lowest version of "${range}". Declare @types/bun as ^X.Y.Z.`);
  }
  return match[1];
}

export function pinOldestBunTypes(appDir) {
  const apiPackage = JSON.parse(readFileSync(join(appDir, "apps/api/package.json"), "utf8"));
  const range = apiPackage.devDependencies?.["@types/bun"];
  if (typeof range !== "string") {
    throw new Error(`${join(appDir, "apps/api/package.json")} does not declare @types/bun.`);
  }
  const version = lowestVersion(range);
  const rootPath = join(appDir, "package.json");
  const rootPackage = JSON.parse(readFileSync(rootPath, "utf8"));
  rootPackage.overrides = {
    ...(rootPackage.overrides ?? {}),
    "@types/bun": version,
    "bun-types": version,
  };
  writeFileSync(rootPath, `${JSON.stringify(rootPackage, null, 2)}\n`);
  return version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const appDir = process.argv[2];
  if (!appDir) {
    console.error("usage: node scripts/oldest-bun-types.mjs <appDir>");
    process.exit(2);
  }
  const version = pinOldestBunTypes(resolve(appDir));
  console.log(`Pinned @types/bun and bun-types to ${version}. Run bun install, then bun run lint.`);
}
