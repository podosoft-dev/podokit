// Copy the repo-root templates/ into the CLI package dist so the published
// binary is self-contained. Run as part of the CLI build step.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoTemplates = join(here, "..", "..", "..", "templates");
const dest = join(here, "..", "dist", "templates");

if (!existsSync(repoTemplates)) {
  console.error(`templates directory not found at ${repoTemplates}`);
  process.exit(1);
}

// Clean first so files removed from templates/ don't linger in dist.
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(repoTemplates, dest, { recursive: true });
console.log(`copied templates -> ${dest}`);
