import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createApp } from "../src/app";
import { validateEnv } from "../src/config/env.validation";
import {
  assertApiContract,
  assertConsistentRouteParameters,
  documentedApiRoutes,
} from "../src/core/api-contract";
import { createCoreServices } from "../src/core/services";

interface ProjectManifest {
  template: string;
  modules: Array<{ name: string }>;
}

const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), "../../.podokit/manifest.json"), "utf8"),
) as ProjectManifest;
const env = validateEnv(process.env);
const services = createCoreServices(env);
const app = createApp({ env, services });
try {
  assertConsistentRouteParameters(app.routes);
  const response = await app.handle(new Request("http://localhost/api-docs-json"));
  if (!response.ok) {
    throw new Error(`OpenAPI request failed (${response.status}): ${await response.text()}`);
  }
  const document: unknown = await response.json();
  const modules = manifest.modules.map((module) => module.name);
  assertApiContract(document, manifest.template, modules);
  process.stdout.write(
    `Verified ${documentedApiRoutes(document).size} documented API operations for ${manifest.template}.\n`,
  );
} finally {
  await services.close();
}
