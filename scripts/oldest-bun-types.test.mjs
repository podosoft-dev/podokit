import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { lowestVersion, pinOldestBunTypes } from "./oldest-bun-types.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("takes the lowest version of exact, caret, and tilde ranges", () => {
  assert.equal(lowestVersion("^1.4.0"), "1.4.0");
  assert.equal(lowestVersion("~1.3.9"), "1.3.9");
  assert.equal(lowestVersion("1.4.3"), "1.4.3");
  assert.throws(() => lowestVersion(">=1.2.0"), /Declare @types\/bun as \^X\.Y\.Z/);
  assert.throws(() => lowestVersion("latest"), /Cannot take the lowest version/);
});

test("the template declares a range whose lowest version the CI check can pin", () => {
  const apiPackage = JSON.parse(
    readFileSync(join(repoRoot, "templates/fullstack/apps/api/package.json"), "utf8"),
  );
  assert.equal(lowestVersion(apiPackage.devDependencies["@types/bun"]), "1.4.0");
});

test("pins @types/bun and bun-types beside the app's own overrides", () => {
  const app = mkdtempSync(join(tmpdir(), "oldest-bun-types-"));
  try {
    mkdirSync(join(app, "apps/api"), { recursive: true });
    writeFileSync(
      join(app, "apps/api/package.json"),
      JSON.stringify({ devDependencies: { "@types/bun": "^1.4.0" } }),
    );
    writeFileSync(
      join(app, "package.json"),
      JSON.stringify({ name: "app", overrides: { "@sveltejs/kit": { cookie: "2.0.1" } } }),
    );

    assert.equal(pinOldestBunTypes(app), "1.4.0");
    assert.deepEqual(JSON.parse(readFileSync(join(app, "package.json"), "utf8")).overrides, {
      "@sveltejs/kit": { cookie: "2.0.1" },
      "@types/bun": "1.4.0",
      "bun-types": "1.4.0",
    });
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});
