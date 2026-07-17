import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SCRIPT = fileURLToPath(
  new URL("../templates/modules/auth/files/apps/api/scripts/configure-auth.mjs", import.meta.url),
);

function dryRun(extraEnv = {}) {
  return spawnSync(process.execPath, [SCRIPT, "--provider", "google", "--dry-run"], {
    encoding: "utf8",
    env: {
      ...process.env,
      AUTH_SETUP_ORIGIN: "https://app-dev.example.com",
      OAUTH_CLIENT_ID: "test-client-id",
      OAUTH_CLIENT_SECRET: "test-client-secret",
      ...extraEnv,
    },
  });
}

function plan(stdout) {
  const start = stdout.indexOf("{");
  assert.notEqual(start, -1);
  return JSON.parse(stdout.slice(start));
}

test("auth configure persists the callback derived from the stable HTTPS origin", () => {
  const result = dryRun();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OAuth callback URL: https:\/\/app-dev\.example\.com\/api\/auth\/callback\/google/);
  assert.equal(
    plan(result.stdout).social.google.redirectURI,
    "https://app-dev.example.com/api/auth/callback/google",
  );
  assert.equal(plan(result.stdout).social.google.clientSecret, "<redacted>");
});

test("auth configure can update only the callback without reading provider credentials", () => {
  const result = spawnSync(
    process.execPath,
    [SCRIPT, "--provider", "google", "--redirect-only", "--dry-run"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        AUTH_SETUP_ORIGIN: "https://app-dev.example.com",
        OAUTH_CLIENT_ID: "",
        OAUTH_CLIENT_SECRET: "",
        GOOGLE_CLIENT_ID: "",
        GOOGLE_CLIENT_SECRET: "",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(plan(result.stdout).social.google, {
    redirectURI: "https://app-dev.example.com/api/auth/callback/google",
  });
});

test("redirect-only requires a provider", () => {
  const result = spawnSync(process.execPath, [SCRIPT, "--redirect-only", "--dry-run"], {
    encoding: "utf8",
    env: { ...process.env, AUTH_SETUP_ORIGIN: "https://app-dev.example.com" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--redirect-only requires --provider/);
});

test("auth configure persists an explicit callback override", () => {
  const result = dryRun({
    OAUTH_REDIRECT_URI: "https://auth.example.com/api/auth/callback/google",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    plan(result.stdout).social.google.redirectURI,
    "https://auth.example.com/api/auth/callback/google",
  );
});
