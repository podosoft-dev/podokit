import type { RequestEvent } from "@sveltejs/kit";
import { isHttpError } from "@sveltejs/kit";
import { ApiError } from "@podosoft/podokit-api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
vi.mock("#lib/server/api.js", () => ({ serverApiClient: () => ({ get }) }));

const { loadBlogComments, loadBlogPost, loadBlogPosts } = await import("./blog-data.server");

const event = {} as RequestEvent;
const outage = (): Error => new TypeError("fetch failed");

async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => undefined, (cause: unknown) => cause);
}

describe("public blog loaders", () => {
  beforeEach(() => {
    get.mockReset();
  });

  it("answers 404 for a missing post instead of a server error", async () => {
    get.mockRejectedValue(new ApiError("BLOG_POST_NOT_FOUND", "Blog post not found.", 404));
    expect(isHttpError(await failure(loadBlogPost(event, "missing")), 404)).toBe(true);
    expect(isHttpError(await failure(loadBlogComments(event, "missing", 1)), 404)).toBe(true);
  });

  it("answers a retryable 503 for a post while the API is down", async () => {
    get.mockRejectedValue(outage());
    expect(isHttpError(await failure(loadBlogPost(event, "post")), 503)).toBe(true);
    get.mockRejectedValue(new ApiError("INTERNAL_ERROR", "Internal server error", 500));
    expect(isHttpError(await failure(loadBlogPost(event, "post")), 503)).toBe(true);
  });

  it("keeps other API errors", async () => {
    const forbidden = new ApiError("FORBIDDEN", "Forbidden", 403);
    get.mockRejectedValue(forbidden);
    expect(await failure(loadBlogPost(event, "post"))).toBe(forbidden);
  });

  it("keeps the post list and comments up during an outage", async () => {
    get.mockRejectedValue(outage());
    expect(await loadBlogPosts(event, 3)).toEqual({
      items: [],
      page: 3,
      pageSize: 10,
      total: 0,
      totalPages: 0,
      unavailable: true,
    });
    expect(await loadBlogComments(event, "post", 2)).toEqual({
      items: [],
      page: 2,
      pageSize: 20,
      total: 0,
      totalPages: 0,
      unavailable: true,
    });
  });

  it("returns API pages unchanged", async () => {
    const page = { items: [{ id: "p1" }], page: 1, pageSize: 10, total: 1, totalPages: 1 };
    get.mockResolvedValue(page);
    expect(await loadBlogPosts(event, 1)).toBe(page);
  });
});
