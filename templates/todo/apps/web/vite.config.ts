import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Inside the dev container (compose.dev.yaml sets VITE_DOCKER=1): bind to all
// interfaces, allow the Traefik hostname, and route HMR's WebSocket back through
// Traefik. The browser reaches the app at Traefik's published host port, so the
// HMR client must target that same port — otherwise the ws connects to :80,
// fails, and Vite silently falls back to a full page reload on every change
// (which wipes in-progress form input). compose.dev.yaml injects
// VITE_HMR_CLIENT_PORT to match the published Traefik port (default 80).
const inDocker = process.env.VITE_DOCKER === "1";
const hmrClientPort = Number(process.env.VITE_HMR_CLIENT_PORT) || 80;

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: inDocker
    ? {
        host: true,
        port: 5001,
        allowedHosts: true,
        hmr: { clientPort: hmrClientPort },
      }
    : undefined,
});
