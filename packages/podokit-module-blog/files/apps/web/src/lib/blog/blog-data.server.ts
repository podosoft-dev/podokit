import type { RequestEvent } from "@sveltejs/kit";
import { serverApiClient } from "$lib/server/api";
import type { BlogComment, BlogDraft, BlogPost, Paginated } from "./types";

export function loadBlogPosts(
  event: RequestEvent,
  page: number,
  pageSize = 10,
): Promise<Paginated<BlogPost>> {
  return serverApiClient(event).get<Paginated<BlogPost>>(`/blog?page=${page}&pageSize=${pageSize}`);
}

export function loadBlogPost(event: RequestEvent, slug: string): Promise<BlogPost> {
  return serverApiClient(event).get<BlogPost>(`/blog/${encodeURIComponent(slug)}`);
}

export function loadBlogComments(
  event: RequestEvent,
  slug: string,
  page: number,
  pageSize = 20,
): Promise<Paginated<BlogComment>> {
  return serverApiClient(event).get<Paginated<BlogComment>>(
    `/blog/${encodeURIComponent(slug)}/comments?page=${page}&pageSize=${pageSize}`,
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
  };
}
