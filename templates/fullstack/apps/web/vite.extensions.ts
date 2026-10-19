import type { Config as SvelteKitConfig } from "@sveltejs/kit/vite";
import type { UserConfig, UserConfigFnObject } from "vite";

/**
 * Application-owned additions to the managed vite.config.ts, combined with Vite's
 * `mergeConfig`: lists such as `plugins` are appended and objects are merged key
 * by key. Use it for dev-server warmup, dependency optimization, `define`
 * constants, extra plugins, or extra allowed hosts instead of editing
 * vite.config.ts. A function receives Vite's `{ command, mode }`. WebSocket paths
 * listed in `.podokit/dev.json` already reach the API through the dev server.
 * PodoKit creates this file once and never overwrites it.
 */
export const appViteConfig: UserConfig | UserConfigFnObject = {
  // Transform the pages most sessions open first as soon as the dev server starts:
  // server: { warmup: { clientFiles: ["./src/routes/+layout.svelte", "./src/routes/+page.svelte"] } },
};

/**
 * Application-owned SvelteKit options, such as `alias`, `csrf`, or `prerender`.
 * PodoKit sets `adapter` and `preprocess`, and `paths.origin` from
 * PODOKIT_BUILD_ORIGIN at build time. The managed hooks.server.ts applies
 * `csrf.trustedOrigins` in SvelteKit's place.
 */
export const appSvelteKitConfig: SvelteKitConfig = {};
