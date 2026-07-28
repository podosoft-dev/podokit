/**
 * The production entry point: adapter-node's server plus WebSocket upgrades.
 *
 * `node build` — adapter-node's own entry — serves HTTP perfectly well and drops
 * every WebSocket upgrade into SvelteKit, which cannot answer one. This entry keeps
 * adapter-node in charge of listening, graceful shutdown, and the PORT/HOST/
 * IDLE_TIMEOUT contract, and adds the one thing it cannot do.
 *
 * Nothing is proxied unless `WS_PROXY_PATHS` names a path, so a deployment that has
 * no WebSocket behaves exactly as `node build` did.
 *
 * ⚠ Not type-checked: it imports `./build/`, which only exists after `npm run build`,
 * and lint must not depend on a build. Everything with a decision in it lives in
 * `src/lib/server/ws-upgrade.js`, which is unit-tested; this is wiring.
 */
import { server } from "./build/index.js";
import { createUpgradeProxy, relayPaths } from "./src/lib/server/ws-upgrade.js";

const allowed = relayPaths();
if (allowed.size > 0) {
  // polka exposes the http.Server it was handed. If a future adapter stops doing so,
  // fail at boot: serving silently without upgrades is the bug this entry exists for.
  const httpServer = server.server;
  if (!httpServer || typeof httpServer.on !== "function") {
    throw new Error(
      "adapter-node did not expose its HTTP server; the WebSocket upgrade proxy cannot be mounted",
    );
  }
  httpServer.on("upgrade", createUpgradeProxy({ allowed }));
  console.log(`Mounted WebSocket upgrade proxy for ${[...allowed].join(", ")}`);
}
