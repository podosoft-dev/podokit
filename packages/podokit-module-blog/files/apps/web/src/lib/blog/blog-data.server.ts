import { error, type RequestEvent } from "@sveltejs/kit";
import { ApiError } from "@podosoft/podokit-api-client";
import { serverApiClient } from "#lib/server/api.js";
import type { BlogComment, BlogDraft, BlogPost, Paginated, PublicPage } from "./types";

// A failed fetch is not an ApiError. Timeouts, rate limits, and 5xx are temporary;
// other API errors are answers and keep their status.
function isTemporaryFailure(cause: unknown): boolean {
  if (!(cause instanceof ApiError)) return true;
  return cause.statusCode === 408 || cause.statusCode === 429 || cause.statusCode >= 500;
}

/** A post page needs its post: missing is 404, and an outage is a retryable 503. */
async function contentItem<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (cause: unknown) {
    if (cause instanceof ApiError && cause.statusCode === 404) error(404, "Blog post not found");
    if (isTemporaryFailure(cause)) error(503, "Blog temporarily unavailable");
    throw cause;
  }
}

/** A public list stays up during an outage as an empty page marked unavailable. */
async function contentPage<T>(
  load: () => Promise<Paginated<T>>,
  page: number,
  pageSize: number,
): Promise<PublicPage<T>> {
  try {
    return await load();
  } catch (cause: unknown) {
    if (cause instanceof ApiError && cause.statusCode === 404) error(404, "Blog post not found");
    if (!isTemporaryFailure(cause)) throw cause;
    return { items: [], page, pageSize, total: 0, totalPages: 0, unavailable: true };
  }
}

export function loadBlogPosts(
  event: RequestEvent,
  page: number,
  pageSize = 10,
): Promise<PublicPage<BlogPost>> {
  return contentPage(
    () => serverApiClient(event).get<Paginated<BlogPost>>(`/blog?page=${page}&pageSize=${pageSize}`),
    page,
    pageSize,
  );
}

export function loadMyBlogPosts(
  event: RequestEvent,
  page: number,
  pageSize = 10,
): Promise<Paginated<BlogPost>> {
  return serverApiClient(event).get<Paginated<BlogPost>>(
    `/blog/mine?page=${page}&pageSize=${pageSize}`,
  );
}

export function loadBlogPost(event: RequestEvent, slug: string): Promise<BlogPost> {
  return contentItem(() => serverApiClient(event).get<BlogPost>(`/blog/${encodeURIComponent(slug)}`));
}

export function loadManagedBlogPost(event: RequestEvent, slug: string): Promise<BlogPost> {
  return contentItem(() =>
    serverApiClient(event).get<BlogPost>(`/blog/manage/${encodeURIComponent(slug)}`)
  );
}

export function loadBlogComments(
  event: RequestEvent,
  slug: string,
  page: number,
  pageSize = 20,
): Promise<PublicPage<BlogComment>> {
  return contentPage(
    () => serverApiClient(event).get<Paginated<BlogComment>>(
      `/blog/${encodeURIComponent(slug)}/comments?page=${page}&pageSize=${pageSize}`,
    ),
    page,
    pageSize,
  );
}

export function createBlogPost(event: RequestEvent, draft: BlogDraft): Promise<BlogPost> {
  return serverApiClient(event).post<BlogPost>("/blog", toPayload(draft));
}

export function updateBlogPost(event: RequestEvent, id: string, draft: BlogDraft): Promise<BlogPost> {
  return serverApiClient(event).patch<BlogPost>(`/blog/${id}`, toPayload(draft));
}

export function deleteBlogPost(event: RequestEvent, id: string): Promise<void> {
  return serverApiClient(event).del<void>(`/blog/${id}`);
}

export function createBlogComment(event: RequestEvent, slug: string, body: string): Promise<BlogComment> {
  return serverApiClient(event).post<BlogComment>(`/blog/${encodeURIComponent(slug)}/comments`, { body });
}

export function updateBlogComment(event: RequestEvent, id: string, body: string): Promise<BlogComment> {
  return serverApiClient(event).patch<BlogComment>(`/blog/comments/${id}`, { body });
}

export function deleteBlogComment(event: RequestEvent, id: string): Promise<void> {
  return serverApiClient(event).del<void>(`/blog/comments/${id}`);
}

function toPayload(draft: BlogDraft): Record<string, unknown> {
  return {
    title: draft.title,
    slug: draft.slug || undefined,
    excerpt: draft.excerpt,
    body: draft.body,
    coverImage: draft.coverImage || null,
    tags: draft.tags,
    status: draft.status,
  };
}
