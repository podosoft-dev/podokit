import assert from "node:assert/strict";
import test from "node:test";
import {
  externalPackageSpec,
  planRefreshModules,
  refreshHost,
  restoreDevConfig,
} from "./dev-container-refresh-lib.mjs";

test("plans bundled and external modules separately", () => {
  const plan = planRefreshModules([
    { name: "auth" },
    {
      name: "blog",
      packageName: "@podosoft/podokit-module-blog",
      moduleVersion: "0.2.1",
    },
    { name: "redis" },
  ], "redis,bullmq,blog");

  assert.deepEqual(plan.bundledModules, ["auth", "redis", "bullmq"]);
  assert.deepEqual(plan.externalModules, [{
    name: "blog",
    packageName: "@podosoft/podokit-module-blog",
    moduleVersion: "0.2.1",
  }]);
});

test("pins an external module to the recorded installed version", () => {
  assert.equal(externalPackageSpec({
    packageName: "@podosoft/podokit-module-blog",
    moduleVersion: "0.2.1",
  }), "@podosoft/podokit-module-blog@0.2.1");
  assert.equal(externalPackageSpec({
    packageName: "@podosoft/podokit-module-blog",
  }), "@podosoft/podokit-module-blog");
});

test("uses the first configured CORS origin for the health-check host", () => {
  assert.equal(
    refreshHost("http://admin-demo.localhost,http://localhost"),
    "admin-demo.localhost",
  );
  assert.equal(refreshHost(""), "app.localhost");
});

test("restores dev.json with the direct API paths the regenerated modules added", () => {
  const previous = `${JSON.stringify({
    schemaVersion: 1,
    hostname: "admin-demo.localhost",
    publicUrl: "https://demo.example.com",
    webSocketPaths: [],
    apiPaths: ["/api/import"],
  }, null, 2)}\n`;
  const regenerated = JSON.stringify({
    schemaVersion: 1,
    hostname: "app.localhost",
    webSocketPaths: [],
    apiPaths: ["/api/import/", "/api/files/uploads/"],
  });

  assert.deepEqual(JSON.parse(restoreDevConfig(previous, regenerated)), {
    schemaVersion: 1,
    hostname: "admin-demo.localhost",
    publicUrl: "https://demo.example.com",
    webSocketPaths: [],
    apiPaths: ["/api/import", "/api/files/uploads/"],
  });
  assert.equal(restoreDevConfig(previous, previous), previous);
});
