import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ci = readFileSync(resolve(repoRoot, ".github/workflows/ci.yml"), "utf8");
const e2e = readFileSync(resolve(repoRoot, ".github/workflows/e2e.yml"), "utf8");

test("cancels superseded CI runs for the same workflow and ref", () => {
  assert.match(ci, /group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}/);
  assert.match(ci, /cancel-in-progress: true/);
});

test("keeps the e2e check present while gating expensive PR work at job level", () => {
  assert.doesNotMatch(e2e, /pull_request:\s+paths:/);
  assert.match(e2e, /ready_for_review/);
  assert.match(e2e, /converted_to_draft/);
  assert.match(e2e, /github\.event\.pull_request\.draft == false/);
  assert.match(e2e, /needs\.changes\.outputs\.relevant == 'true'/);
});

test("uses package-only verification for the generated Changesets PR", () => {
  assert.match(e2e, /github\.head_ref == 'changeset-release\/main'/);
  assert.match(e2e, /node scripts\/e2e-ci\.mjs --package-smoke/);
  assert.match(e2e, /node scripts\/e2e-ci\.mjs --smoke/);
  assert.match(e2e, /Cache generated app npm downloads/);
  assert.match(e2e, /E2E_NPM_CACHE: \/home\/runner\/\.cache\/podokit-e2e-npm/);
});
