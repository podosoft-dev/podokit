import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RequestEvent } from "@sveltejs/kit";

type Csrf = typeof import("../../../templates/fullstack/apps/web/src/lib/server/csrf");

// The managed vite.config.ts defines __PODOKIT_CSRF_TRUSTED_ORIGINS__, but a
// config the app owns, such as its own vitest.config.ts, may not. Nothing here
// defines it either, so the module runs as it does there. It is loaded from a
// copy because the template's tsconfig extends one only a generated app has.
vi.mock("$app/env", () => ({ dev: false }));
vi.mock("@sveltejs/kit", () => ({
  json: (body: unknown, init?: ResponseInit): Response => Response.json(body, init),
  text: (body: string, init?: ResponseInit): Response => new Response(body, init),
}));

const SOURCE = resolve(process.cwd(), "..", "..", "templates/fullstack/apps/web/src/lib/server/csrf.ts");
const SITE = "https://app.example.com";
let dir = "";
let csrf: Csrf;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "podokit-csrf-"));
  copyFileSync(SOURCE, join(dir, "csrf.ts"));
  csrf = (await import(join(dir, "csrf.ts"))) as Csrf;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function post(path: string, origin?: string): { request: Request; url: URL } {
  const url = new URL(path, SITE);
  const headers = new Headers(origin === undefined ? {} : { origin });
  return { request: new Request(url, { method: "POST", headers, body: new FormData() }), url };
}

describe("generated cross-site form check without the trusted origins define", () => {
  it("trusts no other origin", () => {
    const foreign = post("/login", "https://cross-site.example");
    expect(csrf.isCrossSiteFormSubmission(foreign.request, foreign.url)).toBe(true);
    const same = post("/login", SITE);
    expect(csrf.isCrossSiteFormSubmission(same.request, same.url)).toBe(false);
    const client = post("/api/items");
    expect(csrf.isCrossSiteFormSubmission(client.request, client.url)).toBe(false);
  });

  it("refuses a cross-site form and passes an API client", () => {
    expect(csrf.refuseCrossSiteForm(post("/login", "https://cross-site.example") as RequestEvent)?.status).toBe(403);
    expect(csrf.refuseCrossSiteForm(post("/api/items") as RequestEvent)).toBeNull();
  });
});
