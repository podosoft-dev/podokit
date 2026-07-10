import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Inside the dev container (compose.dev.yaml sets VITE_DOCKER=1): bind to all
// interfaces, allow the Traefik hostname, and route HMR through Traefik on :80.
const inDocker = process.env.VITE_DOCKER === "1";

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: inDocker
    ? {
        host: true,
        port: 5001,
        allowedHosts: ["app.localhost"],
        hmr: { clientPort: 80 },
      }
    : undefined,
});
