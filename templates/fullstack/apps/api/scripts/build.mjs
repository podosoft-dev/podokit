import { existsSync, readdirSync } from "node:fs";

// Bun inlines process.env.NODE_ENV as "development" unless told otherwise, which
// would make every production check in the bundle, its dependencies included,
// take the development branch. Keep it a read of the runtime environment.
const define = { "process.env.NODE_ENV": "process.env.NODE_ENV" };

const targets = [
  { entrypoint: "src/main.ts", outdir: "dist" },
  { entrypoint: "src/database/migrate.ts", outdir: "dist/database" },
  { entrypoint: "src/migrate.ts", outdir: "dist" },
  { entrypoint: "src/main-worker.ts", outdir: "dist" },
  { entrypoint: "src/bootstrap-admin-runtime.ts", outdir: "dist" },
].filter((target) => existsSync(target.entrypoint));

for (const target of targets) {
  const result = await Bun.build({
    entrypoints: [target.entrypoint],
    outdir: target.outdir,
    target: "bun",
    define,
  });
  if (!result.success) {
    for (const log of result.logs) process.stderr.write(`${log}\n`);
    process.exit(1);
  }
}

if (existsSync("src/migrations")) {
  const migrations = readdirSync("src/migrations")
    .filter((file) => /^\d+-.+\.ts$/.test(file))
    .map((file) => `src/migrations/${file}`);
  if (migrations.length > 0) {
    const result = await Bun.build({
      entrypoints: migrations,
      outdir: "dist/migrations",
      target: "bun",
      define,
      external: ["typeorm"],
    });
    if (!result.success) {
      for (const log of result.logs) process.stderr.write(`${log}\n`);
      process.exit(1);
    }
  }
}
