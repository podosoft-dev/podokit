import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  caretRangeAccepts,
  syncTemplateDependencyRanges,
} from "./sync-template-dependency-ranges.mjs";

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

test("recognizes npm caret compatibility including zero-major versions", () => {
  assert.equal(caretRangeAccepts("^0.2.0", "0.2.4"), true);
  assert.equal(caretRangeAccepts("^0.2.0", "0.3.0"), false);
  assert.equal(caretRangeAccepts("^1.2.0", "1.9.0"), true);
  assert.equal(caretRangeAccepts("^1.2.0", "2.0.0"), false);
});

test("updates incompatible PodoKit ranges in generated app and module manifests", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "podokit-template-ranges-"));
  try {
    writeJson(join(repoRoot, "packages/contracts/package.json"), {
      name: "@podosoft/podokit-contracts",
      version: "0.3.0",
    });
    writeJson(join(repoRoot, "packages/api-client/package.json"), {
      name: "@podosoft/podokit-api-client",
      version: "0.6.1",
    });
    writeJson(join(repoRoot, "templates/app/package.json"), {
      dependencies: {
        "@podosoft/podokit-contracts": "^0.2.0",
        "@podosoft/podokit-api-client": "^0.6.0",
        external: "^4.0.0",
      },
    });
    const moduleManifestPath = join(repoRoot, "templates/modules/auth/module.manifest.json");
    mkdirSync(dirname(moduleManifestPath), { recursive: true });
    writeFileSync(
      moduleManifestPath,
      [
        "{",
        '  "description": "Auth \\u2014 configuration",',
        '  "requires": ["mailer"],',
        '  "dependencies": { "@podosoft/podokit-contracts": "~0.2.0" }',
        "}",
        "",
      ].join("\n"),
    );

    assert.deepEqual(syncTemplateDependencyRanges(repoRoot), [
      "templates/app/package.json",
      "templates/modules/auth/module.manifest.json",
    ]);
    assert.deepEqual(readJson(join(repoRoot, "templates/app/package.json")).dependencies, {
      "@podosoft/podokit-contracts": "^0.3.0",
      "@podosoft/podokit-api-client": "^0.6.0",
      external: "^4.0.0",
    });
    assert.deepEqual(readJson(moduleManifestPath).dependencies, {
      "@podosoft/podokit-contracts": "^0.3.0",
    });
    const updatedModuleSource = readFileSync(moduleManifestPath, "utf8");
    assert.match(updatedModuleSource, /Auth \\u2014 configuration/);
    assert.match(updatedModuleSource, /"requires": \["mailer"\]/);
    assert.deepEqual(syncTemplateDependencyRanges(repoRoot), []);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
