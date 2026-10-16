import { createServer, type IncomingMessage, type Server } from "node:http";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const DEVICES = join(resolve(process.cwd(), "..", "..", "templates"), "modules/admin-dashboard/files/tests/helpers/devices.ts");

describe("signInOnSeparateDevices", () => {
  let server: Server | undefined;
  afterEach(async () => {
    await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
    server = undefined;
    delete process.env.E2E_BASE_URL;
    vi.resetModules();
  });

  async function fakeAuth(status = 200): Promise<{ cookies: (string | undefined)[] }> {
    const seen: { cookies: (string | undefined)[] } = { cookies: [] };
    server = createServer((request: IncomingMessage, response) => {
      seen.cookies.push(request.headers.cookie);
      response.statusCode = status;
      response.setHeader("set-cookie", [
        `better-auth.session_token=token${seen.cookies.length}.sig; Path=/; HttpOnly`,
        `better-auth.session_token_multi-token${seen.cookies.length}=token${seen.cookies.length}.sig; Path=/`,
        "better-auth.session_data=cache; Path=/",
      ]);
      response.end("{}");
    });
    await new Promise<void>((done) => server!.listen(0, "127.0.0.1", () => done()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    process.env.E2E_BASE_URL = `http://127.0.0.1:${address.port}`;
    return seen;
  }

  it("signs in anonymously once and sends only that session cookie afterwards", async () => {
    const seen = await fakeAuth();
    const { signInOnSeparateDevices } = await import(DEVICES);
    const statuses = await signInOnSeparateDevices("many@example.com", "pw", 25);
    expect(statuses).toHaveLength(25);
    expect(statuses.every((status: number) => status === 200)).toBe(true);
    expect(seen.cookies[0]).toBeUndefined();
    expect(new Set(seen.cookies.slice(1))).toEqual(new Set(["better-auth.session_token=token1.sig"]));
  });

  it("stops after a refused first sign-in", async () => {
    const seen = await fakeAuth(429);
    const { signInOnSeparateDevices } = await import(DEVICES);
    expect(await signInOnSeparateDevices("many@example.com", "pw", 105)).toEqual([429]);
    expect(seen.cookies).toHaveLength(1);
  });
});
