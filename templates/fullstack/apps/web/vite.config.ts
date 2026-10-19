import { readFileSync } from "node:fs";
import adapter from "@sveltejs/adapter-bun";
import { sveltekit } from "@sveltejs/kit/vite";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, mergeConfig, type EnvironmentModuleNode, type Plugin, type ProxyOptions } from "vite";
import { appSvelteKitConfig, appViteConfig } from "./vite.extensions.ts";

// Inside the dev container, bind to all interfaces and accept local gateway or
// HTTPS tunnel hostnames. Vite derives HMR's protocol, host, and port from the
// browser origin so the same configuration works for both entry points.
const inDocker = process.env.VITE_DOCKER === "1";
const publicOrigin = process.env.PODOKIT_BUILD_ORIGIN;

/**
 * Dev-server proxies for the exact WebSocket paths in `.podokit/dev.json`. A
 * SvelteKit route cannot answer an upgrade, so `bun run dev` sends these paths to
 * the API the way the `podo dev` gateway and a deployment's edge do. The API must
 * authenticate each upgrade itself.
 */
export function webSocketProxy(
  devConfig: string | null,
  target = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:5002",
): Record<string, ProxyOptions> {
  if (devConfig === null) return {};
  const { webSocketPaths = [] } = JSON.parse(devConfig) as { webSocketPaths?: unknown };
  if (!Array.isArray(webSocketPaths)) throw new Error(".podokit/dev.json webSocketPaths must be an array of paths");
  return Object.fromEntries(
    webSocketPaths.map((path: unknown) => {
      if (typeof path !== "string" || !/^\/[A-Za-z0-9._~!$&'()+,;=:@/-]+$/.test(path)) {
        throw new Error(`.podokit/dev.json webSocketPaths has an invalid path: ${JSON.stringify(path)}`);
      }
      const exact = `^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\?.*)?$`;
      return [exact, { target, ws: true, xfwd: true }];
    }),
  );
}

/**
 * Drops the cached transform of a file that was deleted or created again. Vite
 * keeps a module's last transform when its file is deleted and does not drop it
 * when the file returns, and vite-plugin-svelte compares the returning
 * component with that cached result. A component deleted and re-created, as a
 * rebase or branch switch does, kept serving its first version to the browser
 * until its next edit. This runs before the other hot-update hooks.
 */
export function refreshRecreatedFiles(): Plugin {
  return {
    name: "podokit:refresh-recreated-files",
    apply: "serve",
    hotUpdate: {
      order: "pre",
      handler({ type, modules, timestamp }) {
        if (type === "update") return;
        const invalidated = new Set<EnvironmentModuleNode>();
        for (const module of modules) {
          this.environment.moduleGraph.invalidateModule(module, invalidated, timestamp, true);
        }
      },
    },
  };
}

function readDevConfig(): string | null {
  try {
    return readFileSync(new URL("../../.podokit/dev.json", import.meta.url), "utf8");
  } catch (cause) {
    if ((cause as { code?: unknown }).code === "ENOENT") return null;
    throw cause;
  }
}

export default defineConfig((env) =>
  mergeConfig(
    {
      plugins: [
        refreshRecreatedFiles(),
        tailwindcss(),
        sveltekit({
          adapter: adapter(),
          preprocess: vitePreprocess(),
          ...appSvelteKitConfig,
          ...(publicOrigin ? { paths: { ...appSvelteKitConfig.paths, origin: publicOrigin } } : {}),
        }),
      ],
      server: {
        ...(inDocker ? { host: true, port: 5001, allowedHosts: true } : {}),
        ...(env.command === "serve" ? { proxy: webSocketProxy(readDevConfig()) } : {}),
      },
    },
    typeof appViteConfig === "function" ? appViteConfig(env) : appViteConfig,
  ),
);
