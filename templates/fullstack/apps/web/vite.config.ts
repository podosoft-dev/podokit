import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Inside the dev container, bind to all interfaces and accept local gateway or
// HTTPS tunnel hostnames. Vite derives HMR's protocol, host, and port from the
// browser origin so the same configuration works for both entry points.
const inDocker = process.env.VITE_DOCKER === "1";

// Dev parity for WebSocket upgrades. In production `server.js` proxies these paths to
// the API; without the same allowlist here, a feature would work in one and not the
// other -- which is exactly how a WebSocket gateway used to reach production dead.
// Set WS_PROXY_PATHS in the shell that runs vite; a .env file cannot reach this file.
const wsProxyPaths = (process.env.WS_PROXY_PATHS ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry.startsWith("/"));
const backendTarget = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:5002";
const wsProxy = Object.fromEntries(
  wsProxyPaths.map((path) => [path, { target: backendTarget, ws: true, changeOrigin: false }]),
);

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    ...(inDocker ? { host: true, port: 5001, allowedHosts: true } : {}),
    ...(wsProxyPaths.length ? { proxy: wsProxy } : {}),
  },
});
