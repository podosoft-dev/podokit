#!/usr/bin/env node
// Reproduces a Bun bug that stalled the containerized Vite dev server.
//
// Before it listens, Vite checks its port by binding a bare probe server on
// each wildcard address and closing it again. On Bun 1.4.0 a client that
// connects and sends a request while a probe is bound leaves a paused socket
// whose end is never seen, so `server.close()` never calls back and Vite never
// listens. A gateway or browser polling a web container that is still
// starting hit this often. Bun 1.4.1 fixed it ("a paused net.Socket never emitted 'end' when the
// peer closed the connection, so server.close() hung").
//
// Clients have to come from outside the container and send data; loopback
// clients, or clients that only connect, rarely hit the window.
//
// Usage: node scripts/bun-port-probe-repro.mjs [bun version] [rounds]
//   Defaults to the version pinned in packages/cli/src/toolchain.ts.
//   Exit 0: every probe closed. Exit 1: a probe close never called back.
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import net from "node:net";

const pinned = /BUN_VERSION = "([^"]+)"/.exec(
  readFileSync(new URL("../packages/cli/src/toolchain.ts", import.meta.url), "utf8"),
)?.[1];
const version = process.argv[2] ?? pinned;
const rounds = Number(process.argv[3] ?? 300);
const name = `podokit-bun-probe-${process.pid}`;

// Vite's isPortAvailable(): bind and close a bare server on every wildcard host.
const probe = `
import net from "node:net";
const hosts = ["0.0.0.0", "::", "0000:0000:0000:0000:0000:0000:0000:0000"];
const tryListen = (host) => new Promise((resolve) => {
  const server = net.createServer();
  server.once("error", () => server.close(() => resolve(true)));
  server.once("listening", () => server.close(() => resolve(true)));
  server.listen(5001, host);
});
console.log("ready");
for (let round = 0; round < ${rounds}; round++) {
  for (const host of hosts) {
    const closed = await Promise.race([tryListen(host), new Promise((r) => setTimeout(() => r(false), 3000))]);
    if (!closed) { console.log("HUNG round " + round + " host " + host); process.exit(1); }
  }
}
console.log("CLOSED " + ${rounds} + " rounds");
`;

const docker = (...args) => execFileSync("docker", args, { encoding: "utf8" }).trim();

docker("run", "-d", "--name", name, "--entrypoint", "bun", `oven/bun:${version}-alpine`, "-e", probe);
let exitCode = 1;
try {
  const ip = docker("inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", name);
  // Clients send a request and give up after 300 ms, like a gateway health probe.
  const hammer = setInterval(() => {
    const socket = net.connect(5001, ip, () => socket.write("GET / HTTP/1.1\r\nHost: web\r\n\r\n"));
    socket.on("error", () => {});
    setTimeout(() => socket.destroy(), 300);
  }, 20);
  const status = await new Promise((resolve) => {
    const wait = spawn("docker", ["wait", name], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    wait.stdout.on("data", (chunk) => (out += chunk));
    wait.on("close", () => resolve(Number(out.trim())));
  });
  clearInterval(hammer);
  const logs = docker("logs", name);
  console.log(`bun ${version}: ${logs.split("\n").at(-1)}`);
  exitCode = status === 0 ? 0 : 1;
} finally {
  docker("rm", "-f", name);
}
process.exit(exitCode);
