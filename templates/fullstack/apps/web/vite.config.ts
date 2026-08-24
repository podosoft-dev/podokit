import adapter from "@sveltejs/adapter-bun";
import { sveltekit } from "@sveltejs/kit/vite";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Inside the dev container, bind to all interfaces and accept local gateway or
// HTTPS tunnel hostnames. Vite derives HMR's protocol, host, and port from the
// browser origin so the same configuration works for both entry points.
const inDocker = process.env.VITE_DOCKER === "1";
const publicOrigin = process.env.PODOKIT_BUILD_ORIGIN;

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      adapter: adapter(),
      preprocess: vitePreprocess(),
      ...(publicOrigin ? { paths: { origin: publicOrigin } } : {}),
      alias: {
        $lib: "src/lib",
        $i18n: "src/lib/i18n",
      },
    }),
  ],
  server: {
    ...(inDocker ? { host: true, port: 5001, allowedHosts: true } : {}),
  },
});
