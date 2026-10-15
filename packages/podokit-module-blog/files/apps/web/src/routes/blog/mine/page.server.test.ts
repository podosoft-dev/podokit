import { isHttpError, isRedirect } from "@sveltejs/kit";
import { describe, expect, it, vi } from "vitest";

vi.mock("#lib/blog/blog-data.server.js", () => ({ loadMyBlogPosts: vi.fn() }));

const { load } = await import("./+page.server");

type LoadEvent = Parameters<typeof load>[0];

function event(locals: Record<string, unknown>): LoadEvent {
  return {
    locals,
    setHeaders: () => undefined,
    url: new URL("http://localhost/blog/mine"),
  } as unknown as LoadEvent;
}

describe("my posts loader", () => {
  it("answers 503 instead of a sign-in redirect while sessions cannot be checked", async () => {
    const outage = await Promise.resolve(load(event({ authUnavailable: true }))).catch((cause: unknown) => cause);
    expect(isHttpError(outage, 503)).toBe(true);
  });

  it("still sends anonymous visitors to sign in", async () => {
    const anonymous = await Promise.resolve(load(event({}))).catch((cause: unknown) => cause);
    expect(isRedirect(anonymous)).toBe(true);
  });
});
