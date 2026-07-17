import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Inside the dev container, bind to all interfaces and accept local gateway or
// HTTPS tunnel hostnames. Vite derives HMR's protocol, host, and port from the
// browser origin so the same configuration works for both entry points.
const inDocker = process.env.VITE_DOCKER === "1";

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: inDocker
    ? {
        host: true,
        port: 5001,
        allowedHosts: true,
      }
    : undefined,
});
