import adapter from "@sveltejs/adapter-bun";
import { sveltekit } from "@sveltejs/kit/vite";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, mergeConfig } from "vite";
import { appSvelteKitConfig, appViteConfig } from "./vite.extensions.ts";

// Inside the dev container, bind to all interfaces and accept local gateway or
// HTTPS tunnel hostnames. Vite derives HMR's protocol, host, and port from the
// browser origin so the same configuration works for both entry points.
const inDocker = process.env.VITE_DOCKER === "1";
const publicOrigin = process.env.PODOKIT_BUILD_ORIGIN;

export default defineConfig((env) =>
  mergeConfig(
    {
      plugins: [
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
      },
    },
    typeof appViteConfig === "function" ? appViteConfig(env) : appViteConfig,
  ),
);
