#!/usr/bin/env node
// Live dev loop: mirror edits to the template sources into a running dev app,
// so changes show up immediately via the app's HMR (web) / --watch (api).
//
// Usage (run the app in watch mode first, then this):
//   node scripts/dev-watch.mjs <appDir> [--template <t>] [--module m1,m2] [--once]
//
// IMPORTANT: a generated app is base-template + module overlays + marker
// injections. This mirrors only files that generation copies VERBATIM. It never
// touches files that modules inject into (marker files) or that a module
// overlays from the base, so it can't clobber wiring like app.module.ts,
// auth.ts, or the @Public health controller.
import { watch } from "node:fs";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const appDir = positional[0] && resolve(positional[0]);
if (!appDir || !existsSync(appDir)) {
  console.error("usage: node scripts/dev-watch.mjs <appDir> [--template <t>] [--module m1,m2] [--once]");
  process.exit(1);
}
const template = flag("template") ?? "fullstack-nest-svelte";
const requested = (flag("add") ?? flag("module") ?? "").split(",").map((m) => m.trim()).filter(Boolean);
const appName = appDir.split(sep).pop();
const modulesRoot = join(repoRoot, "templates", "modules");

const readManifest = (m) => {
  const p = join(modulesRoot, m, "module.manifest.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
};

// Resolve the full module set (transitive `requires`), dependency-first order.
const moduleOrder = [];
const seen = new Set();
function addModule(m) {
  if (seen.has(m)) return;
  seen.add(m);
  const man = readManifest(m);
  if (!man) return;
  for (const req of man.requires ?? []) addModule(req);
  moduleOrder.push(m);
}
for (const m of requested) addModule(m);

// app-relative path with the dot- filename convention applied.
const toRel = (rel) =>
  rel.split("/").map((seg) => (seg.startsWith("dot-") ? `.${seg.slice(4)}` : seg)).join("/");

function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(relative(root, full).split(sep).join("/"));
    }
  };
  if (existsSync(root)) walk(root);
  return out;
}

// Injection targets (never overwrite — generated file has injected content).
const injectTargets = new Set();
// App-relative paths a module overlays (module version is authoritative; skip base).
const overlayPaths = new Set();
for (const m of moduleOrder) {
  const man = readManifest(m);
  for (const inj of man?.inject ?? []) injectTargets.add(inj.file);
  for (const rel of listFiles(join(modulesRoot, m, "files"))) overlayPaths.add(toRel(rel));
}

const HARD_SKIP = new Set(["package.json", "package-lock.json", "dot-env.example"]);

// sources in generation order: base template, then modules (deps first)
const sources = [
  { root: join(repoRoot, "templates", template), isBase: true },
  ...moduleOrder.map((m) => ({ root: join(modulesRoot, m, "files"), isBase: false })),
].filter((s) => existsSync(s.root));

function shouldMirror(rel, base, isBase) {
  if (HARD_SKIP.has(base)) return false;
  if (injectTargets.has(rel)) return false; // marker/injection target
  if (isBase && overlayPaths.has(rel)) return false; // a module owns this path
  return true;
}

function mirror(srcRoot, isBase, absFile) {
  if (!existsSync(absFile) || statSync(absFile).isDirectory()) return false;
  const raw = relative(srcRoot, absFile).split(sep).join("/");
  const rel = toRel(raw);
  const base = rel.split("/").pop();
  if (!shouldMirror(rel, base, isBase)) return false;
  let content = readFileSync(absFile, "utf8");
  // extra guard: never mirror a file that carries injection markers
  if (content.includes("// podokit:")) return false;
  content = content.replace(/\{\{\s*projectName\s*\}\}/g, appName);
  const dest = join(appDir, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, content);
  return true;
}

// initial sync
let synced = 0;
for (const { root, isBase } of sources) {
  for (const rel of listFiles(root)) {
    if (mirror(root, isBase, join(root, rel))) synced += 1;
  }
}
console.log(`Initial sync: ${synced} files → ${appDir}  (modules: ${moduleOrder.join(", ") || "none"})`);
console.log(`Skipped ${injectTargets.size} injection target(s) and module-owned/base-owned overlaps to protect generated wiring.`);

if (args.includes("--once")) process.exit(0);

const debounce = new Map();
for (const { root, isBase } of sources) {
  watch(root, { recursive: true }, (_e, filename) => {
    if (!filename) return;
    const abs = join(root, filename);
    clearTimeout(debounce.get(abs));
    debounce.set(abs, setTimeout(() => {
      try {
        if (mirror(root, isBase, abs)) console.log(`↻ ${relative(root, abs).split(sep).join("/")}`);
      } catch { /* transient */ }
    }, 60));
  });
}
console.log("Watching template sources (Ctrl-C to stop)…");
