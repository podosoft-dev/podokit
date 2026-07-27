import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  initializeDeploymentProfile,
  loadDeploymentProfile,
  profilePath,
} from "./deploy-profile";
import { initLockfile } from "./lockfile";

const created: string[] = [];

function initializedProfile(): string {
  const root = mkdtempSync(join(tmpdir(), "podokit-deploy-profile-"));
  created.push(root);
  mkdirSync(join(root, "apps", "api"), { recursive: true });
  initLockfile(root, {
    template: "fullstack-nest-svelte",
    packageManager: "npm",
    answers: { projectName: "example-app" },
    version: "0.15.0",
  });
  initializeDeploymentProfile(root, "production", {
    context: "production",
    clusterFingerprint: `sha256:${"a".repeat(64)}`,
    host: "app.example.com",
  });
  return root;
}

afterEach(() => {
  for (const directory of created.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("deployment profile verification origin", () => {
  it.each([
    "https://deploy-user@example.com",
    "https://deploy-user:deploy-password@example.com",
  ])("rejects URL credentials in verification baseUrl: %s", (baseUrl) => {
    const root = initializedProfile();
    const path = profilePath(root, "production");
    const profile = JSON.parse(readFileSync(path, "utf8")) as {
      verification: { baseUrl: string };
    };
    profile.verification.baseUrl = baseUrl;
    writeFileSync(path, JSON.stringify(profile));

    expect(() => loadDeploymentProfile(root, "production")).toThrow(
      "verification baseUrl must not contain URL credentials",
    );
  });
});

describe("deployment profile migration command", () => {
  it("omits migration configuration from initialized profiles", () => {
    const root = initializedProfile();
    const path = profilePath(root, "production");
    const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

    expect(value).not.toHaveProperty("migration");
    expect(loadDeploymentProfile(root, "production").migration).toBeUndefined();
  });

  it("accepts a non-empty custom migration command", () => {
    const root = initializedProfile();
    const path = profilePath(root, "production");
    const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    value.migration = { command: ["node", "dist/migrate"] };
    writeFileSync(path, JSON.stringify(value));

    expect(loadDeploymentProfile(root, "production").migration).toEqual({
      command: ["node", "dist/migrate"],
    });
  });

  it.each<[Record<string, unknown>, string]>([
    [{ command: [] }, "must be a non-empty string array"],
    [{ command: [""] }, "must be a non-empty string"],
    [{ command: ["node\nmalicious: value"] }, "must not contain control characters"],
    [{ command: ["node\u0000malicious"] }, "must not contain control characters"],
    [{ command: ["node"], unexpected: true }, "contains unknown key"],
  ])("rejects an invalid migration profile %#", (migration, message) => {
    const root = initializedProfile();
    const path = profilePath(root, "production");
    const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    value.migration = migration;
    writeFileSync(path, JSON.stringify(value));

    expect(() => loadDeploymentProfile(root, "production")).toThrow(message);
  });
});
