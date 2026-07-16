import assert from "node:assert/strict";
import test from "node:test";
import { externalPackageSpec, planRefreshModules } from "./dev-container-refresh-lib.mjs";

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
