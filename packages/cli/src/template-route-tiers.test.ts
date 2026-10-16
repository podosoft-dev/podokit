import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_OWNED_GLOBS, classifyTier } from "./lockfile";

const MODULES = resolve(__dirname, "..", "..", "..", "templates", "modules");

type ModuleManifest = { ownedGlobs?: string[]; managedOverrides?: string[] };

/**
 * The page-data fields each application-owned page reads when PodoKit manages
 * the server load beside it. An owned page never receives updates, so a field it
 * starts reading would reach existing apps only through the managed load and the
 * feature would arrive half-way. Render a new field in a managed component the
 * page already passes `data` to, such as AccountPage, instead of adding it here.
 */
const OWNED_PAGE_DATA: Record<string, string[]> = {
  "admin-dashboard:apps/web/src/routes/(admin)/+layout.svelte": ["capabilities", "impersonating", "user"],
  "admin-dashboard:apps/web/src/routes/(admin)/admin/account/+page.svelte": [],
  "admin-dashboard:apps/web/src/routes/(admin)/admin/audit/+page.svelte": [],
  "admin-dashboard:apps/web/src/routes/(admin)/admin/organizations/+page.svelte": [],
  "admin-dashboard:apps/web/src/routes/(admin)/admin/sessions/+page.svelte": [],
  "admin-dashboard:apps/web/src/routes/(admin)/admin/settings/+page.svelte": ["authConfig", "capabilities", "require2fa"],
  "admin-dashboard:apps/web/src/routes/(admin)/admin/users/+page.svelte": ["capabilities", "currentUserId"],
  "admin-dashboard:apps/web/src/routes/(auth)/login/+page.svelte": ["capabilities", "idleLogout", "oauthError"],
  "admin-dashboard:apps/web/src/routes/(auth)/signup/+page.svelte": ["capabilities"],
  "admin-dashboard:apps/web/src/routes/account/+page.svelte": ["user"],
  "admin-dashboard:apps/web/src/routes/setup-2fa/+page.svelte": [],
};

/** Top-level fields read through the `data` prop of a Svelte page or layout. */
function pageDataFields(source: string): string[] {
  if (!/let\s*\{[^}]*\bdata\b[^}]*\}[^=]*=\s*\$props\(\)/s.test(source)) return [];
  return [...new Set([...source.matchAll(/\bdata\.([A-Za-z_$][\w$]*)/g)].map((match) => match[1] ?? ""))].sort();
}

/** Owned pages and layouts whose server load a module keeps managed. */
function ownedPagesBesideManagedLoads(): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const module of readdirSync(MODULES)) {
    const manifestPath = join(MODULES, module, "module.manifest.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ModuleManifest;
    const owned = [...DEFAULT_OWNED_GLOBS, ...(manifest.ownedGlobs ?? [])];
    const managed = manifest.managedOverrides ?? [];
    for (const load of managed.filter((path) => /\/routes\/.*\+(page|layout)\.server\.ts$/.test(path))) {
      const page = load.replace(/\.server\.ts$/, ".svelte");
      const file = join(MODULES, module, "files", page);
      if (!existsSync(file)) continue;
      const source = readFileSync(file, "utf8");
      if (classifyTier(page, source, owned, managed) !== "owned") continue;
      found[`${module}:${page}`] = pageDataFields(source);
    }
  }
  return found;
}

describe("route tiers", () => {
  it("keeps the data owned pages read from managed loads unchanged", () => {
    expect(ownedPagesBesideManagedLoads()).toEqual(OWNED_PAGE_DATA);
  });

  it("finds the fields a page reads through its data prop", () => {
    expect(pageDataFields('let { data }: { data: PageData } = $props();\n{data.user.name} {data.capabilities}')).toEqual([
      "capabilities",
      "user",
    ]);
    // A `data` variable of an API response is not page data.
    expect(pageDataFields("const { data } = await api.get();\nreturn data.totpURI;")).toEqual([]);
  });
});
