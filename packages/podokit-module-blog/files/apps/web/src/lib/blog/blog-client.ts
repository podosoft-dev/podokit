import type { BlogComment, BlogDraft, BlogPost, Paginated } from "./types";

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

export class BlogApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "BlogApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorEnvelope;
    throw new BlogApiError(
      body.error?.code ?? "BLOG_REQUEST_FAILED",
      body.error?.message ?? "Blog request failed.",
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function payload(draft: BlogDraft): string {
  return JSON.stringify({
    title: draft.title,
    slug: draft.slug || undefined,
    excerpt: draft.excerpt,
    body: draft.body,
    coverImage: draft.coverImage || null,
    tags: draft.tags,
    status: draft.status,
  });
}

export function createPost(draft: BlogDraft): Promise<BlogPost> {
  return request<BlogPost>("/blog", { method: "POST", body: payload(draft) });
}

export function updatePost(id: string, draft: BlogDraft): Promise<BlogPost> {
  return request<BlogPost>(`/blog/${id}`, { method: "PATCH", body: payload(draft) });
}

export function deletePost(id: string): Promise<void> {
  return request<void>(`/blog/${id}`, { method: "DELETE" });
}

export function adminCreatePost(draft: BlogDraft): Promise<BlogPost> {
  return request<BlogPost>("/admin/blog", { method: "POST", body: payload(draft) });
}

export function adminUpdatePost(id: string, draft: BlogDraft): Promise<BlogPost> {
  return request<BlogPost>(`/admin/blog/${id}`, { method: "PATCH", body: payload(draft) });
}

export function adminDeletePost(id: string): Promise<void> {
  return request<void>(`/admin/blog/${id}`, { method: "DELETE" });
}

export function loadComments(slug: string, page: number): Promise<Paginated<BlogComment>> {
  return request<Paginated<BlogComment>>(`/blog/${encodeURIComponent(slug)}/comments?page=${page}`);
}

export function createComment(slug: string, body: string): Promise<BlogComment> {
  return request<BlogComment>(`/blog/${encodeURIComponent(slug)}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export function updateComment(id: string, body: string): Promise<BlogComment> {
  return request<BlogComment>(`/blog/comments/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ body }),
  });
}

export function deleteComment(id: string): Promise<void> {
  return request<void>(`/blog/comments/${id}`, { method: "DELETE" });
}
