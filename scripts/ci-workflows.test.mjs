import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ci = readFileSync(resolve(repoRoot, ".github/workflows/ci.yml"), "utf8");
const e2e = readFileSync(resolve(repoRoot, ".github/workflows/e2e.yml"), "utf8");
const release = readFileSync(resolve(repoRoot, ".github/workflows/release.yml"), "utf8");
const version = readFileSync(resolve(repoRoot, ".github/workflows/version.yml"), "utf8");

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
  assert.match(ci, /workflow_dispatch:/);
  assert.match(e2e, /github\.head_ref == 'changeset-release\/main'/);
  assert.match(e2e, /inputs\.mode == 'package-smoke'/);
  assert.match(e2e, /node scripts\/e2e-ci\.mjs --package-smoke/);
  assert.match(e2e, /node scripts\/e2e-ci\.mjs --smoke/);
  assert.match(e2e, /Cache generated app npm downloads/);
  assert.match(e2e, /E2E_NPM_CACHE: \/home\/runner\/\.cache\/podokit-e2e-npm/);
  assert.match(version, /actions: write/);
  assert.match(version, /gh workflow run ci\.yml --ref changeset-release\/main/);
  assert.match(version, /gh workflow run e2e\.yml --ref changeset-release\/main -f mode=package-smoke/);
});

test("publishes a GitHub Release only after npm packages succeed", () => {
  assert.match(release, /permissions:\s+contents: write/);
  const createRelease = release.indexOf("name: Create GitHub release");
  const publishSteps = [...release.matchAll(/^\s+- name: Publish .+$/gm)];
  assert.ok(publishSteps.length > 0);
  assert.ok(publishSteps.every((step) => (step.index ?? -1) < createRelease));
  assert.match(release, /gh release view "\$GITHUB_REF_NAME"/);
  assert.match(release, /gh release create "\$GITHUB_REF_NAME"/);
  assert.match(release, /--verify-tag/);
  assert.match(release, /--generate-notes/);
});
