// Bundle the public docs into the MCP package dist so `search_docs` works
// offline in the published package. Run as part of the build.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoDocs = join(here, "..", "..", "..", "docs");
const dest = join(here, "..", "dist", "docs");

if (!existsSync(repoDocs)) {
  console.error(`docs directory not found at ${repoDocs}`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const file of readdirSync(repoDocs).filter((f) => f.endsWith(".md"))) {
  cpSync(join(repoDocs, file), join(dest, file));
}
console.log(`copied docs -> ${dest}`);
